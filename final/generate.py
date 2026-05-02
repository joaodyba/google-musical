import json
import pandas as pd
import wikipedia
import unicodedata
import sys
import asyncio 
import requests 

# Define a língua para a pesquisa na Wikipedia
wikipedia.set_lang("pt")

def normalize_string_py(s):
    """
    Normaliza uma string para comparação consistente e uso como chave em dicionários:
    remove acentos, converte para minúsculas e remove espaços e alguns caracteres especiais.
    """
    if not isinstance(s, str):
        return ""
    # Python 3: normalize para NFD e remove caracteres combinados (acentos)
    normalized = unicodedata.normalize('NFD', s).encode('ascii', 'ignore').decode('utf-8')
    normalized = (
        normalized.lower()
        .replace(" ", "") # Remove espaços
        .replace("-", "") # Remove hifens
        .replace("_", "") # Remove underscores (útil para tags)
    )
    # Remove caracteres que não são letras ou números, mantendo apenas alfanuméricos
    # Isso é importante para chaves de dicionário, mas para Wikipedia, o nome original é geralmente melhor.
    # Esta função será usada para sanitizar o input, não para a query primária da Wikipedia.
    return normalized

# Função para usar o Gemini para desambiguar gêneros
async def get_most_relevant_genre_from_gemini(genre_name, options):
    """
    Usa o modelo Gemini para identificar a opção de gênero musical mais relevante
    a partir de uma lista de opções de desambiguação da Wikipedia.
    Solicita uma resposta estruturada em JSON para melhor parsing.
    """
    print(f"  [GEMINI_CALL] Chamando Gemini para desambiguar '{genre_name}'...")
    options_list_formatted = "\n".join([f"- {opt}" for opt in options])
    
    prompt = f"""Para o termo principal '{genre_name}', aqui estão várias opções de desambiguação da Wikipedia.

Opções:
{options_list_formatted}

Minha tarefa é identificar qual dessas opções representa *exclusivamente um gênero musical*. É CRÍTICO que você **EVITE** selecionar opções que se refiram a:
- Álbuns de música (ex: "Nome do Artista (álbum)")
- Bandas ou grupos musicais
- Software, jogos, canais de TV, ou qualquer coisa que não seja um gênero ou estilo musical.
- **Regiões geográficas, países, idiomas, culturas, nacionalidades ou demografia (ex: "América Latina", "Língua espanhola", "Cultura africana", "População asiática", "Oriente Médio", "Afro-americano", "Americano", "Britânico").**
- Períodos históricos ou movimentos políticos.

Se o termo for "Latin", a resposta esperada é um gênero musical como "Música Latina" ou "Latin music", e NÃO uma região geográfica.
Se o termo for "Electronic", a resposta esperada é um gênero musical como "Música eletrônica" ou "Electronic dance music", e NÃO um grupo musical.
Sempre priorize a opção que claramente define um gênero ou estilo musical.

Responda APENAS com um objeto JSON no seguinte formato:
```json
{{
  "selectedGenre": "Nome da opção selecionada aqui",
  "reasoning": "Breve explicação da sua escolha"
}}
```
Se nenhuma opção for claramente um gênero musical, ou se todas as opções forem inadequadas (como regiões geográficas), responda:
```json
{{
  "selectedGenre": "Nenhum",
  "reasoning": "Nenhuma opção clara de gênero musical encontrada ou todas as opções são inadequadas (ex: região)."
}}
```
"""
    chat_history = [{ "role": "user", "parts": [{ "text": prompt }] }]
    
    generation_config = {
        "responseMimeType": "application/json",
        "responseSchema": {
            "type": "OBJECT",
            "properties": {
                "selectedGenre": {"type": "STRING"},
                "reasoning": {"type": "STRING"}
            },
            "required": ["selectedGenre", "reasoning"]
        }
    }
    
    payload = { 
        "contents": chat_history,
        "generationConfig": generation_config
    }
    
    apiKey = "AIzaSyA1CHjvaVZLCfnJXthcsSyCwytwIxI77wk" 
    apiUrl = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={apiKey}"

    try:
        response = requests.post(
            apiUrl,
            headers={'Content-Type': 'application/json'},
            json=payload
        )
        response.raise_for_status()
        result_json_str = response.json().get('candidates', [{}])[0].get('content', {}).get('parts', [{}])[0].get('text', '{}')
        
        try:
            gemini_response_parsed = json.loads(result_json_str)
            gemini_choice = gemini_response_parsed.get('selectedGenre')
            gemini_reasoning = gemini_response_parsed.get('reasoning')

            if gemini_choice and gemini_choice != "Nenhum":
                print(f"  [GEMINI_RESPONSE] Gemini sugeriu: '{gemini_choice}' (Razão: {gemini_reasoning})")
                for opt in options:
                    if opt.lower() == gemini_choice.lower():
                        return opt 
                print(f"  [GEMINI_WARNING] Escolha do Gemini '{gemini_choice}' não corresponde a nenhuma opção original da Wikipedia (mesmo ignorando case).")
            else:
                print(f"  [GEMINI_RESPONSE] Gemini não encontrou um gênero musical claro. Razão: {gemini_reasoning}")
        except json.JSONDecodeError:
            print(f"  [GEMINI_WARNING] Resposta do Gemini não é um JSON válido: {result_json_str}")
        
    except requests.exceptions.RequestException as e:
        print(f"  [GEMINI_ERROR] Erro ao chamar a API do Gemini (requests): {e}")
    except Exception as e:
        print(f"  [GEMINI_ERROR] Erro inesperado ao processar resposta do Gemini: {e}")
    return None 

async def get_wikipedia_summary(genre_name, sentences=None):
    """
    Busca um resumo da Wikipedia para um dado gênero musical.
    Tenta algumas variações do nome do gênero para melhorar a chance de encontrar.
    Prioriza opções de desambiguação que contenham termos musicais específicos e correspondências exatas.
    Usa Gemini para desambiguação se houver múltiplas opções.
    """
    search_queries = []
    
    # NOVO: Caso especial para 'Latin' para priorizar o gênero musical
    if genre_name.lower() == "latin":
        search_queries.append("Música latina") # Tenta o termo direto em português
        search_queries.append("Latin music")    # Tenta o termo direto em inglês
    
    # Adiciona as queries gerais após as específicas
    search_queries.extend([
        genre_name,
        f"{genre_name} (música)",
        f"História do {genre_name}",
        f"{genre_name} music", 
        f"{genre_name} (genre)", 
    ])

    # Remove duplicatas e mantém a ordem preferencial
    unique_search_queries = []
    seen = set()
    for query in search_queries:
        if query not in seen:
            unique_search_queries.append(query)
            seen.add(query)

    for query in unique_search_queries: # Usa a lista de queries únicas
        try:
            summary_text = wikipedia.summary(query, sentences=sentences)
            return summary_text
        except wikipedia.exceptions.PageError:
            print(f"  [WIKI_INFO] Página não encontrada para '{query}'. Tentando a próxima variação...")
        except wikipedia.exceptions.DisambiguationError as e:
            print(f"  [WIKI_INFO] Desambiguação para '{query}'. Opções: {e.options}")
            
            gemini_preferred_option = await get_most_relevant_genre_from_gemini(genre_name, e.options)
            
            if gemini_preferred_option:
                try:
                    print(f"  [WIKI_INFO] Tentando opção de desambiguação sugerida pelo Gemini: '{gemini_preferred_option}'")
                    summary_text = wikipedia.summary(gemini_preferred_option, sentences=sentences)
                    return summary_text
                except (wikipedia.exceptions.PageError, wikipedia.exceptions.DisambiguationError) as inner_e:
                    print(f"  [WIKI_INFO] Falha ao obter resumo para a opção sugerida pelo Gemini '{gemini_preferred_option}': {inner_e}")
            
            genre_lower = genre_name.lower()
            musical_priority_phrases = [
                f"{genre_lower} (gênero musical)", 
                f"gênero musical {genre_lower}",
                f"{genre_lower} musical genre",
                f"musical genre {genre_lower}",
                f"{genre_lower} (música)",
                f"{genre_lower} music",
                f"música {genre_lower}",
                "música eletrônica" if genre_lower == "electronic" else "", 
                "balada" if genre_lower == "ballad" else "", 
                "música",                   
                "music",                    
                "gênero",                   
                genre_lower                 
            ]
            musical_priority_phrases = [p for p in musical_priority_phrases if p]
            
            exclusion_keywords = [
                "álbum", "software", "jogo", "canal", "série", "protocol", 
                "p.o.p", "point of presence", "poluentes orgânicos persistentes", 
                "filme", "website", "banda", "grupo", "disco", "região", "geografia", "país", "idioma", "cultura", "demografia", "nacionalidade" 
            ]
            
            selected_option = None
            lower_case_options = [opt.lower() for opt in e.options]

            for phrase in musical_priority_phrases:
                for i, option_lower in enumerate(lower_case_options):
                    if any(excl in option_lower for excl in exclusion_keywords):
                        continue
                    
                    if option_lower == phrase or option_lower.startswith(phrase):
                        selected_option = e.options[i]
                        print(f"  [WIKI_INFO] Correspondência de alta prioridade (startswith/exact) encontrada (heurística): '{phrase}' em '{selected_option}'")
                        break
                if selected_option:
                    break
            
            if not selected_option:
                for phrase in musical_priority_phrases:
                    for i, option_lower in enumerate(lower_case_options):
                        if any(excl in option_lower for excl in exclusion_keywords):
                            continue
                        if phrase in option_lower:
                            selected_option = e.options[i]
                            print(f"  [WIKI_INFO] Correspondência de alta prioridade (substring) encontrada (heurística): '{phrase}' em '{selected_option}'")
                            break
                    if selected_option:
                        break

            if selected_option:
                try:
                    print(f"  [WIKI_INFO] Tentando opção de desambiguação heurística: '{selected_option}'")
                    summary_text = wikipedia.summary(selected_option, sentences=sentences)
                    return summary_text
                except (wikipedia.exceptions.PageError, wikipedia.exceptions.DisambiguationError) as inner_e:
                    print(f"  [WIKI_INFO] Falha ao obter resumo para a opção heurística '{selected_option}': {inner_e}")
            
            print(f"  [WIKI_INFO] Nenhuma opção de desambiguação útil encontrada para '{query}'.")
        except Exception as e:
            print(f"  [WIKI_ERROR] Erro inesperado ao buscar '{query}': {e}")
    return None

async def generate_genre_history(input_filepath='counter.json', output_filepath='genre_history.json', top_n=100):
    """
    Gera um JSON com a história e importância dos top N gêneros de um arquivo counter.json.
    """
    print(f"--- Iniciando geração da história dos gêneros de {input_filepath} ---")

    try:
        with open(input_filepath, 'r', encoding='utf-8') as f:
            genre_counts = json.load(f)
        print(f"Successfully loaded '{input_filepath}'.")
    except FileNotFoundError:
        print(f"ERROR: '{input_filepath}' not found. Please ensure it exists in the same directory.")
        sys.exit(1)
    except json.JSONDecodeError:
        print(f"ERROR: Could not decode JSON from '{input_filepath}'. Check file format.")
        sys.exit(1)
    except Exception as e:
        print(f"ERROR: An unexpected error occurred while loading '{input_filepath}': {e}")
        sys.exit(1)

    if not isinstance(genre_counts, dict):
        print(f"ERROR: Expected '{input_filepath}' to contain a JSON object (dictionary), but got {type(genre_counts)}.")
        print("Please ensure your counter.json is structured like: {\"Pop\": 120, \"Rock\": 90, ...}")
        sys.exit(1)

    if not genre_counts:
        print("No genre counts found in counter.json. Outputting empty genre history.")
        with open(output_filepath, 'w', encoding='utf-8') as f:
            json.dump({"genre_history": []}, f, indent=2, ensure_ascii=False)
        return

    df_genres = pd.DataFrame(list(genre_counts.items()), columns=['genre', 'count'])
    df_genres = df_genres.sort_values(by='count', ascending=False)
    
    top_genres = df_genres['genre'].head(top_n).tolist()
    print(f"Top {top_n} genres identified: {top_genres}")

    genre_history_data = []
    for genre in top_genres:
        print(f"Fetching Wikipedia summary for '{genre}'...")
        summary = await get_wikipedia_summary(genre, sentences=None)
        
        if summary:
            genre_history_data.append({
                "genre": genre,
                "history": summary
            })
            print(f"  Summary found for '{genre}'.")
        else:
            genre_history_data.append({
                "genre": genre,
                "history": f"Nenhuma informação detalhada de história encontrada para o gênero '{genre}'."
            })
            print(f"  No summary found for '{genre}'.")

        output_data = {"genre_history": genre_history_data}
        try:
            with open(output_filepath, 'w', encoding='utf-8') as f:
                json.dump(output_data, f, indent=2, ensure_ascii=False)
            print(f"  Updated '{output_filepath}' with data for '{genre}'.")
        except Exception as e:
            print(f"  ERROR: Could not update '{output_filepath}' for '{genre}': {e}")


if __name__ == '__main__':
    asyncio.run(generate_genre_history())
