import json
import os
import time
import pandas as pd
import requests

def get_first_artist(artist):
    splitters = [' Featuring ', ' & ', ' feat. ', ' x ', ',']
    for splitter in splitters:
        if splitter in artist:
            return artist.split(splitter)[0].strip()
    return artist.strip()

def save_progress(index, songs_data, progress_file='dict_progress.txt', data_file='songs.json'):
    with open(progress_file, 'w') as f:
        f.write(str(index))
    with open(data_file, 'w', encoding='utf-8') as f:
        json.dump(songs_data, f, indent=4, ensure_ascii=False)

def load_progress(progress_file='dict_progress.txt', data_file='songs.json'):
    start_index = 0
    songs_data = []
    if os.path.exists(progress_file):
        with open(progress_file, 'r') as f:
            content = f.read().strip()
            if content.isdigit():
                start_index = int(content)
    if os.path.exists(data_file):
        with open(data_file, 'r', encoding='utf-8') as f:
            songs_data = json.load(f)
    return start_index, songs_data

# Configurações iniciais
file = 'newcharts.csv'
df = pd.read_csv(file)
start_index, songs_data = load_progress()
print(f"Começando do índice: {start_index}")

url = "https://api.discogs.com/database/search"
headers = {"User-Agent": "Google Musical/1.0"}
token = "uQtYeRGLfhqsfgYPtgQvaSAIyrFTXmMMiYJLWwgp"
max_retries = 5
fixed_sleep = 0.3  # segundos

# Loop principal
for idx, row in enumerate(df.itertuples(index=False), start=0):
    if idx < start_index:
        continue

    first_artist = get_first_artist(row.artist)
    title = row.song
    weeks = row.weeks_on_board

    params = {
        "q": f"{first_artist} {title}",
        "type": "release",
        "per_page": 1,
        "pages": 1,
        "token": token
    }

    retry_delay = 5

    for attempt in range(max_retries):
        try:
            response = requests.get(url, params=params, headers=headers, timeout=10)
            status = response.status_code

            if status == 429:
                print(f"429 - {first_artist} - {title} (tentativa {attempt+1}). Aguardando {retry_delay}s...")
                time.sleep(retry_delay)
                retry_delay *= 2
                continue
            elif status == 200:
                data = response.json()
                results = data.get("results")
                if results:
                    result = results[0]
                    genres = result.get('genre', [])
                    styles = result.get('style', [])
                    year = result.get('year', None)

                    song_entry = {
                        "artist": row.artist,
                        "song": row.song,
                        "genres": genres,
                        "styles": styles,
                        "year": year,
                        "weeks_on_board": weeks
                    }

                    songs_data.append(song_entry)
                    print(f"{first_artist} - {title}: {genres} / {styles} / {year} ({weeks} semanas)")
                else:
                    print(f"Nenhum resultado para {first_artist} - {title}")
                break
            else:
                print(f"Erro {status} para {first_artist} - {title}")
                break
        except Exception as e:
            print(f"Erro inesperado para {first_artist} - {title}: {e}")
            break

    # Salvar progresso a cada loop
    save_progress(idx + 1, songs_data)

    # Delay entre requisições
    time.sleep(fixed_sleep)

# Ordenar músicas por weeks_on_board (descendente)
songs_data.sort(key=lambda x: x['weeks_on_board'], reverse=True)

# Salvar o arquivo final
with open('songs_dictionary.json', 'w', encoding='utf-8') as f:
    json.dump(songs_data, f, indent=4, ensure_ascii=False)

print(f"\nDicionário de músicas salvo com {len(songs_data)} entradas (ordenado por weeks_on_board).")
