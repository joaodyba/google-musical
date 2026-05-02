import json
from collections import Counter, OrderedDict
import pandas as pd
import requests
import os
import time

def get_first_artist(artist):
    splitters = [' Featuring ', ' & ', ' feat. ', ' x ', ',']
    for splitter in splitters:
        if splitter in artist:
            return artist.split(splitter)[0].strip()
    return artist.strip()

def save_progress(index, counter, progress_file='progress.txt', counter_file='counter.json'):
    with open(progress_file, 'w') as f:
        f.write(str(index))
    ordered_counter = OrderedDict(counter.most_common())
    with open(counter_file, 'w') as f:
        json.dump(ordered_counter, f, indent=4)

def load_progress(progress_file='progress.txt', counter_file='counter.json'):
    start_index = 0
    genre_counter = Counter()
    if os.path.exists(progress_file):
        with open(progress_file, 'r') as f:
            content = f.read().strip()
            if content.isdigit():
                start_index = int(content)
    if os.path.exists(counter_file):
        with open(counter_file, 'r') as f:
            data = json.load(f)
            genre_counter = Counter(data)
    return start_index, genre_counter

# Configurações iniciais
file = 'newcharts.csv'
df = pd.read_csv(file)
start_index, genre_counter = load_progress()
print(f"Começando do índice: {start_index}")

url = "https://api.discogs.com/database/search"
headers = {"User-Agent": "Google Musical/1.0"}
max_retries = 5
fixed_sleep = 0.3  # 0.7 segundos entre requisições bem-sucedidas

# Loop mais eficiente usando itertuples (mais rápido que loc/iloc)
for idx, row in enumerate(df.itertuples(index=False), start=0):
    if idx < start_index:
        continue

    first_artist = get_first_artist(row.artist)
    title = row.song

    params = {
        "q": f"{first_artist} {title}",
        "type": "release",
        "per_page": 1,
        "pages": 1,
        "token": "uQtYeRGLfhqsfgYPtgQvaSAIyrFTXmMMiYJLWwgp"
    }

    retry_delay = 5  # segundos para backoff

    for attempt in range(max_retries):
        try:
            response = requests.get(url, params=params, headers=headers, timeout=10)
            status = response.status_code

            if status == 429:
                print(f"Erro 429 (tentativa {attempt+1}/{max_retries}) - {first_artist} - {title}. Esperando {retry_delay}s...")
                time.sleep(retry_delay)
                retry_delay *= 2
                continue
            elif status == 200:
                data = response.json()
                results = data.get("results")
                if results:
                    genres_styles = results[0].get('genre', []) + results[0].get('style', [])
                    print(f"{first_artist} - {title}: {genres_styles} ({row.weeks_on_board} semanas)")

                    for genre in genres_styles:
                        genre_counter[genre] += row.weeks_on_board
                else:
                    print(f"Nenhum resultado para {first_artist} - {title}")

                break
            else:
                print(f"Erro {status} para {first_artist} - {title}")
                break
        except Exception as e:
            print(f"Erro inesperado para {first_artist} - {title}: {e}")
            break

    # Salva o progresso a cada loop
    save_progress(idx + 1, genre_counter)

    # Delay entre requisições bem-sucedidas
    time.sleep(fixed_sleep)

print("\nContagem total dos gêneros e estilos encontrados:")
for genre, count in genre_counter.most_common():
    print(f"{genre}: {count}")
