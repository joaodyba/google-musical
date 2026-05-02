import pandas as pd

file = 'charts.csv'
df = pd.read_csv(file)

# Corrigir a coluna 'date'
df['date'] = pd.to_datetime(df['date'], errors='coerce')

# Limpar colunas e dados
df.columns = [col.replace('-', '_') for col in df.columns]
df['artist'] = df['artist'].str.strip()
df['song'] = df['song'].str.strip()

# Detectar músicas natalinas (sazonais)
def is_christmas_recurrent(group):
    months = group['date'].dt.month
    years = group['date'].dt.year.nunique()
    only_in_holiday_months = months.isin([11, 12, 1]).all()
    appears_in_multiple_years = years >= 2
    return only_in_holiday_months and appears_in_multiple_years

seasonal_songs = set()
for (artist, song), group in df.groupby(['artist', 'song']):
    if is_christmas_recurrent(group):
        seasonal_songs.add((artist, song))

# Filtrar músicas natalinas
df['key'] = list(zip(df['artist'], df['song']))
df_filtered = df[~df['key'].isin(seasonal_songs)].copy()

# Corrigir weeks_on_board
df_filtered['weeks_on_board'] = pd.to_numeric(df_filtered['weeks_on_board'], errors='coerce').fillna(1).astype(int)

# Ordenar pela data antes de agrupar (pra garantir que pega a primeira aparição)
df_filtered = df_filtered.sort_values(by='date', ascending=True)

# Agrupar, mantendo a estrutura original
agg_funcs = {col: 'first' for col in df_filtered.columns if col not in ['weeks_on_board', 'key']}
agg_funcs['weeks_on_board'] = 'sum'

df_final = df_filtered.groupby(['artist', 'song']).agg(agg_funcs).reset_index(drop=True)

# Ordenar o resultado final pela data
df_final = df_final.sort_values(by='weeks_on_board', ascending=False)

df_final = df_final[df_final['weeks_on_board'] > 100]

# Remover a coluna auxiliar
if 'key' in df_final.columns:
    df_final = df_final.drop(columns=['key'])

# Salvar CSV
df_final.to_csv('newcharts.csv', index=False)

print(f"Preprocessamento completo. newcharts.csv gerado com {len(df_final)} músicas únicas.")
