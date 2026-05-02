import pandas as pd
import json
import requests
import re
import time
import os

# Configurações para a API da Wikipedia
# Mudar para a API da Wikipedia em Português
WIKIPEDIA_API_URL = "https://pt.wikipedia.org/w/api.php"
WIKIPEDIA_LANGUAGE = 'pt' # Definir o idioma para português
USER_AGENT = 'MusicalWebDataCollector/1.0 (seu.email@exemplo.com)' # Substitua com seu email

# Função para obter informações da Wikipedia usando requests
def get_wikipedia_summary(title, sentences=3, max_length=700): # max_length ajustado para 700
    """
    Obtém um resumo e o texto completo de uma página da Wikipedia usando a API JSON.
    Tenta primeiro buscar a introdução. Se falhar, tenta buscar o texto completo
    e extrai o resumo manualmente.
    sentences: número de sentenças para o resumo curto.
    max_length: comprimento máximo para o resumo completo antes de truncar.
    O conteúdo será buscado no idioma português.
    """
    headers = {
        'User-Agent': USER_AGENT
    }

    # Parâmetros para buscar apenas a introdução (exintro)
    params_intro = {
        'action': 'query',
        'format': 'json',
        'titles': title,
        'prop': 'extracts',
        'exintro': True,  # Retorna apenas a introdução
        'explaintext': True, # Retorna texto simples, sem HTML
        'exsentences': sentences, # Número de sentenças para o resumo
        'redirects': 1, # Segue redirecionamentos
        'uselang': WIKIPEDIA_LANGUAGE # Define o idioma da interface e do extrato
    }

    # Parâmetros para buscar o texto completo da página
    params_full = {
        'action': 'query',
        'format': 'json',
        'titles': title,
        'prop': 'extracts',
        'explaintext': True, # Retorna texto simples, sem HTML
        'redirects': 1, # Segue redirecionamentos
        'uselang': WIKIPEDIA_LANGUAGE # Define o idioma da interface e do extrato
    }

    full_text = None
    short_summary = None

    # Tentar buscar com exintro primeiro
    try:
        response = requests.get(WIKIPEDIA_API_URL, params=params_intro, headers=headers)
        response.raise_for_status()
        data = response.json()
        
        # Verifica se a página existe e se não é uma página de "não encontrado" (como quando page_id é -1)
        page_id = next(iter(data['query']['pages']))
        page = data['query']['pages'][page_id]

        if 'extract' in page and page_id != '-1':
            temp_full_text = page['extract']
            # Heurística simples para detectar páginas de desambiguação
            if temp_full_text and not temp_full_text.strip().lower().startswith(('esta página', 'esta é uma página', 'este artigo', 'este termo', 'ver também')): # Adicionado 'ver também'
                full_text = temp_full_text
    except Exception as e:
        pass # Continua para a busca de texto completo se a introdução falhar

    # Se a busca inicial não retornou um extract útil, tentar buscar o texto completo
    if not full_text:
        try:
            response = requests.get(WIKIPEDIA_API_URL, params=params_full, headers=headers)
            response.raise_for_status()
            data = response.json()

            page_id = next(iter(data['query']['pages']))
            page = data['query']['pages'][page_id]

            if 'extract' in page and page_id != '-1':
                full_text = page['extract']
        except Exception as e:
            pass
    
    # Processar o texto se algo foi encontrado
    if full_text:
        full_text = re.sub(r'\[\d+\]', '', full_text) # Limpa referências
        
        # Extrair resumo curto manualmente
        short_summary_sentences = full_text.split('.')[:sentences]
        short_summary = '.'.join(short_summary_sentences)
        if len(short_summary_sentences) > 0 and not short_summary.endswith('.'):
            short_summary += '.' 

        # Truncar o texto completo
        if len(full_text) > max_length:
            full_text = full_text[:max_length] + "..."

        return short_summary.strip(), full_text.strip()
    else:
        return None, None

# Carregar o arquivo songs.json
try:
    with open('songs.json', 'r', encoding='utf-8') as f:
        songs_data = json.load(f)
    print("songs.json carregado com sucesso.")
except FileNotFoundError:
    print("Erro: songs.json não encontrado. Certifique-se de que o arquivo está na mesma pasta.")
    exit()

# Converter para DataFrame Pandas para facilitar a manipulação
df = pd.DataFrame(songs_data)

# --- FILTRAR MÚSICAS ---
initial_song_count = len(df)
df = df[df['weeks_on_board'] > 120]
filtered_song_count = len(df)
print(f"Total de músicas antes do filtro: {initial_song_count}")
print(f"Músicas removidas (weeks_on_board <= 120): {initial_song_count - filtered_song_count}")
print(f"Total de músicas a serem processadas após filtro: {filtered_song_count}")
# --- FIM DO FILTRO ---

# Adicionar colunas para histórico da música e do gênero
df['song_history_short'] = None
df['song_history_full'] = None
df['genre_history_short'] = None
df['genre_history_full'] = None

# Conjunto para armazenar gêneros já processados (para evitar chamadas repetidas à API)
processed_genres = {}

# Definir o nome do arquivo de saída
output_filename = 'songs_enriched.json'

# Tentar carregar o arquivo enriquecido existente para continuar de onde parou
if os.path.exists(output_filename):
    try:
        with open(output_filename, 'r', encoding='utf-8') as f:
            existing_enriched_data = json.load(f)
        existing_df = pd.DataFrame(existing_enriched_data)
        
        # Merge com o DataFrame original para manter as colunas existentes
        # E garantir que as novas colunas None sejam mantidas para músicas não processadas
        df = df.set_index(['artist', 'song']).combine_first(existing_df.set_index(['artist', 'song'])).reset_index()
        print(f"'{output_filename}' carregado. Continuando o processamento...")
    except Exception as e:
        print(f"Erro ao carregar '{output_filename}': {e}. Iniciando do zero.")

print("\nIniciando coleta de histórico das músicas e gêneros...")
for index, row in df.iterrows():
    # Pular músicas que já têm histórico (para continuar processamento)
    if pd.notna(row['song_history_short']) and pd.notna(row['genre_history_short']):
        print(f"Música {index + 1}/{len(df)} (já processada) pulada.")
        continue

    artist = row['artist']
    song_title = row['song']
    year = row['year'] # O ano pode ser útil para refinar a busca

    song_short, song_full = None, None

    # Tentar várias consultas de pesquisa para a música
    # Prioridade para combinações de Artista + Música + (canção)
    song_queries = [
        f"{song_title} (canção de {artist})", # MAIS ESPECÍFICO: "Radioactive (canção de Imagine Dragons)"
        f"{song_title} de {artist}",         # "Radioactive de Imagine Dragons"
        f"{song_title} ({artist})",          # "Radioactive (Imagine Dragons)"
        f"{song_title} (canção)",            # "Radioactive (canção)"
        f"{song_title}",                     # "Radioactive" (última opção)
        f"{song_title} ({year} canção)" if year else None, # Se o ano for útil
        f"{song_title} (álbum)",             # Para desambiguação
        f"{song_title} (single)",            # Para desambiguação
    ]
    # Se o título começa com "The ", tente a busca sem "The " também (e variantes em pt)
    if isinstance(song_title, str) and song_title.lower().startswith('the '):
        cleaned_title = song_title[4:].strip() 
        song_queries.append(f"{cleaned_title} (canção de {artist})")
        song_queries.append(f"{cleaned_title} de {artist}")
        song_queries.append(f"{cleaned_title} ({artist})")
        song_queries.append(f"{cleaned_title} (canção)")
        song_queries.append(cleaned_title)
        song_queries.append(f"{cleaned_title} ({year} canção)" if year else None)
        song_queries.append(f"{cleaned_title} (álbum)")
        song_queries.append(f"{cleaned_title} (single)")


    # Filtra consultas None e remove duplicatas (se houver)
    song_queries = list(dict.fromkeys([q for q in song_queries if q is not None and q.strip()])) 

    print(f"Processando música {index + 1}/{len(df)}: '{song_title}' de '{artist}'")
    for query_song in song_queries:
        if song_short is not None or song_full is not None:
            break
        song_short, song_full = get_wikipedia_summary(query_song, sentences=3)
        time.sleep(0.05) 
    
    df.at[index, 'song_history_short'] = song_short
    df.at[index, 'song_history_full'] = song_full

    # Busca por histórico do gênero principal (se houver)
    if row['genres'] and len(row['genres']) > 0:
        primary_genre = row['genres'][0] 
        
        if primary_genre not in processed_genres:
            genre_short, genre_full = get_wikipedia_summary(f"{primary_genre} música", sentences=4) 
            processed_genres[primary_genre] = {'short': genre_short, 'full': genre_full}
            time.sleep(0.05) 
        
        df.at[index, 'genre_history_short'] = processed_genres[primary_genre]['short']
        df.at[index, 'genre_history_full'] = processed_genres[primary_genre]['full']
    
    # Salvar o progresso APÓS cada música
    df.to_json(output_filename, orient='records', indent=4, force_ascii=False)
    print(f"Progresso salvo para música {index + 1}. Arquivo '{output_filename}' atualizado.")
    
    time.sleep(0.05) 

print("\nColeta de dados concluída. Salvando o arquivo final...")

# Salvar o DataFrame atualizado em um novo arquivo JSON (salvamento final, redundante mas garante)
df.to_json(output_filename, orient='records', indent=4, force_ascii=False)

# Confirmação explícita de salvamento
print(f"Arquivo '{output_filename}' salvo com sucesso no diretório: {os.getcwd()}")
