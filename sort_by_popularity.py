import json
import requests
import os
import base64

# --- CONFIGURAÇÃO ---
# Substitua COM_SEU_CLIENT_ID e COM_SEU_CLIENT_SECRET pelos seus valores reais do Spotify!
SPOTIFY_CLIENT_ID = "31a82bcbb7054191a961df0a349833a9"
SPOTIFY_CLIENT_SECRET = "bb660dddfb86408ab72c9683212c0904"

# Determina o diretório do script atual
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
# Constrói o caminho completo para tags.json usando o diretório do script
TAGS_FILE = os.path.join(SCRIPT_DIR, 'tags_original.json') # OU 'tags_original.json' se esse for o nome real do seu arquivo


# URLs CORRETAS e REAIS da API do Spotify
SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"
SPOTIFY_GENRE_SEEDS_URL = "https://api.spotify.com/v1/recommendations/available-genre-seeds"

def get_spotify_access_token():
    """Obtém um token de acesso da API do Spotify usando Client Credentials Flow."""
    auth_string = f"{SPOTIFY_CLIENT_ID}:{SPOTIFY_CLIENT_SECRET}"
    auth_bytes = auth_string.encode("utf-8")
    auth_base64 = base64.b64encode(auth_bytes).decode("utf-8")

    headers = {
        "Authorization": f"Basic {auth_base64}",
        "Content-Type": "application/x-www-form-urlencoded"
    }
    body = {
        "grant_type": "client_credentials"
    }

    print("Obtendo token de acesso do Spotify...")
    try:
        response = requests.post(SPOTIFY_TOKEN_URL, headers=headers, data=body)
        response.raise_for_status() # Lança um erro para status HTTP ruins (4xx ou 5xx)
        token_info = response.json()
        print("Token obtido com sucesso.")
        return token_info.get("access_token")
    except requests.exceptions.RequestException as e:
        print(f"Erro ao obter token de acesso do Spotify: {e}")
        # Tenta imprimir a resposta se disponível para mais detalhes
        if 'response' in locals():
            print(f"Resposta do Spotify: {response.text}")
        return None
    except json.JSONDecodeError:
        print("Erro ao decodificar a resposta JSON do token do Spotify.")
        return None

def get_spotify_genre_seeds(access_token):
    """Busca os gêneros disponíveis como seeds na API do Spotify."""
    if not access_token:
        print("Token de acesso não fornecido para buscar gêneros do Spotify.")
        return None

    headers = {
        "Authorization": f"Bearer {access_token}"
    }

    print(f"Buscando gêneros do Spotify em: {SPOTIFY_GENRE_SEEDS_URL}")
    try:
        response = requests.get(SPOTIFY_GENRE_SEEDS_URL, headers=headers)
        response.raise_for_status() # Lança um erro para status HTTP ruins (4xx ou 5xx)
        data = response.json()

        genres = []
        if 'genres' in data:
            genres = [g.lower() for g in data['genres']] # Converte para minúsculas
        
        print(f"Encontrados {len(genres)} gêneros no Spotify.")
        return set(genres) # Usamos um set para busca rápida
    
    except requests.exceptions.RequestException as e:
        print(f"Erro ao obter gêneros do Spotify: {e}")
        print(f"Resposta do Spotify: {response.text if 'response' in locals() else 'N/A'}")
        return None
    except json.JSONDecodeError:
        print("Erro ao decodificar a resposta JSON dos gêneros do Spotify.")
        return None

def load_local_tags():
    """Carrega as tags do seu arquivo tags.json local."""
    if not os.path.exists(TAGS_FILE):
        print(f"Arquivo {TAGS_FILE} não encontrado. Por favor, verifique se ele existe e está no diretório correto.")
        return []
    with open(TAGS_FILE, 'r', encoding='utf-8') as f:
        try:
            data = json.load(f)
            # Adapta para as diferentes estruturas que você possa ter tido
            if isinstance(data, list) and all(isinstance(item, str) for item in data):
                print(f"Tags locais carregadas de {TAGS_FILE}: {len(data)} tags.")
                return data
            elif isinstance(data, list) and all(isinstance(item, dict) and 'value' in item for item in data):
                flattened_tags = [item['value'] for item in data]
                print(f"Tags locais carregadas e achatadas de {TAGS_FILE}: {len(flattened_tags)} tags.")
                return flattened_tags
            elif isinstance(data, dict):
                flattened_tags = [tag for sublist in data.values() for tag in sublist]
                print(f"Tags locais carregadas e achatadas de {TAGS_FILE}: {len(flattened_tags)} tags.")
                return flattened_tags
            else:
                print(f"Estrutura inesperada em {TAGS_FILE}. Retornando lista vazia.")
                return []
        except json.JSONDecodeError:
            print(f"Erro ao decodificar JSON em {TAGS_FILE}. Verifique a sintaxe do arquivo JSON.")
            return []

def save_local_tags(tags_list):
    """Salva a lista de tags (reordenada) de volta no tags.json."""
    with open(TAGS_FILE, 'w', encoding='utf-8') as f:
        json.dump(tags_list, f, indent=2, ensure_ascii=False)
    print(f"Tags reordenadas salvas em {TAGS_FILE}.")

def main():
    """Função principal para orquestrar a busca e ordenação."""
    
    # 1. Obter token de acesso do Spotify
    access_token = get_spotify_access_token()
    if not access_token:
        print("Não foi possível obter token de acesso do Spotify. Saindo.")
        return

    # 2. Obter gêneros do Spotify (seeds)
    spotify_genres = get_spotify_genre_seeds(access_token)
    if spotify_genres is None:
        print("Não foi possível obter gêneros do Spotify. Saindo.")
        return

    # 3. Carregar suas tags locais
    local_tags = load_local_tags()
    if not local_tags:
        print("Nenhuma tag para ordenar no arquivo local. Saindo.")
        return
    
    # 4. Separar tags encontradas e não encontradas no Spotify
    found_in_spotify = []
    not_found_in_spotify = []
    
    for tag in local_tags:
        if tag.lower() in spotify_genres:
            found_in_spotify.append(tag)
        else:
            not_found_in_spotify.append(tag)
            
    # 5. Ordenar as tags:
    # As encontradas no Spotify vêm primeiro, ordenadas alfabeticamente.
    # As não encontradas vêm depois, também ordenadas alfabeticamente.
    found_in_spotify.sort(key=lambda x: x.lower())
    not_found_in_spotify.sort(key=lambda x: x.lower())

    # 6. Combinar as listas
    new_sorted_tags = found_in_spotify + not_found_in_spotify

    # 7. Salvar as tags reordenadas de volta no arquivo
    save_local_tags(new_sorted_tags)
    
    print("\n--- Processo Concluído ---")
    print("Suas tags foram reordenadas. Gêneros reconhecidos pelo Spotify estão no topo (ordenados alfabeticamente), seguidos pelos não reconhecidos (também alfabeticamente).")
    print("Verifique seu arquivo tags.json.")

if __name__ == '__main__':
    main()
