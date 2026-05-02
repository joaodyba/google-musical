import matplotlib.pyplot as plt
import pandas as pd
import json

# Carregar os dados do arquivo JSON fornecido.
# Certifique-se de que o arquivo 'counter.json' esteja no mesmo diretório
# onde este script está sendo executado, ou forneça o caminho completo.
try:
    with open('counter.json', 'r') as f:
        data = json.load(f)
except FileNotFoundError:
    print("Erro: O arquivo 'counter.json' não foi encontrado. Certifique-se de que o arquivo esteja no diretório correto.")
    exit()
except json.JSONDecodeError:
    print("Erro: Não foi possível decodificar o arquivo JSON. Verifique a sintaxe do JSON.")
    exit()

# Converter o dicionário JSON para um DataFrame do pandas
df = pd.DataFrame(list(data.items()), columns=['Genero', 'Ouvintes'])

# Converter a coluna 'Ouvintes' para numérica
df['Ouvintes'] = pd.to_numeric(df['Ouvintes'], errors='coerce')
df.dropna(subset=['Ouvintes'], inplace=True) # Remover linhas onde a conversão falhou

# Classificar os dados em ordem decrescente de ouvintes
df = df.sort_values(by='Ouvintes', ascending=False)

# Usar todos os gêneros para o gráfico, sem agrupamento
plot_df = df.copy()

# Preparar os dados para o gráfico de pizza
labels = plot_df['Genero']
sizes = plot_df['Ouvintes']

# Preparar o 'explode' sem explosão para todas as fatias
explode_values = [0] * len(plot_df)

# Criação do gráfico de pizza
fig1, ax1 = plt.subplots(figsize=(10, 10)) # Tamanho do gráfico ajustado para 10x10 para um pouco mais de espaço

# Configuração do gráfico de pizza
# Passar os rótulos diretamente para a função pie e remover autopct (porcentagem)
wedges, texts, autotexts = ax1.pie( # NOVO: Capturando 'autotexts'
    sizes,
    explode=explode_values,
    labels=labels, # Adicionado de volta para exibir o nome do gênero
    autopct='%1.1f%%', # NOVO: Ativado para exibir porcentagens
    pctdistance=0.8, # Distância das porcentagens do centro da fatia
    shadow=False, # Sem sombra para manter a clareza
    startangle=90,
    textprops=dict(color="black"), # Cor padrão do texto dos rótulos (opacidade será definida abaixo)
    rotatelabels=True, # Rotaciona os rótulos para apontar para suas fatias
    labeldistance=1.0 # Mantido no padrão para evitar que o texto fique muito próximo do centro
)

# Ajustar o tamanho da fonte e a opacidade dos rótulos dinamicamente
max_listeners = plot_df['Ouvintes'].max() # Valor do gênero 'Pop'
min_listeners = plot_df['Ouvintes'].min() # Valor do menor gênero

# Tamanhos de fonte para os nomes dos gêneros
pop_genre_font_size = 15 # Tamanho explícito para 'Pop'
max_genre_font_size_others = 12 # Tamanho máximo para outros gêneros grandes (Rock, Hip Hop, etc.)
min_genre_font_size = 1 # Tamanho mínimo para qualquer rótulo de gênero (pode ser difícil de ler)

# NOVO: Tamanhos de fonte para as porcentagens
pop_pct_font_size = 20 # Tamanho explícito para a porcentagem de 'Pop'
max_pct_font_size_others = 10 # Tamanho máximo para outras porcentagens
min_pct_font_size = 0 # Tamanho mínimo para qualquer rótulo de porcentagem

max_alpha = 1.0 # Opacidade máxima (totalmente opaco)
min_alpha = 0.0 # Opacidade mínima (totalmente transparente)

# Limites de ouvintes para controlar a transição da opacidade
start_fade_value = 60000 # Opacidade total para gêneros com mais de 60000 ouvintes
end_fade_value = 3000    # Opacidade zero (ou min_alpha) para gêneros com 3000 ou menos ouvintes

# Iterar sobre os objetos de texto (nomes dos gêneros e porcentagens)
# e as linhas do DataFrame para definir o tamanho da fonte e a opacidade
for i, (text_genre, text_pct, (idx, row)) in enumerate(zip(texts, autotexts, plot_df.iterrows())):
    genre = row['Genero']
    listeners = row['Ouvintes']

    # Lógica para NOMES DOS GÊNEROS
    if genre == "Pop":
        font_size_genre = pop_genre_font_size
        alpha_genre = max_alpha # Pop sempre totalmente opaco
    elif listeners >= start_fade_value:
        font_size_genre = max_genre_font_size_others
        alpha_genre = max_alpha
    elif listeners <= end_fade_value:
        font_size_genre = min_genre_font_size
        alpha_genre = min_alpha
    else:
        # Normalização para o intervalo de fade
        if (start_fade_value - end_fade_value) == 0:
            normalized_value = 0
        else:
            normalized_value = (listeners - end_fade_value) / (start_fade_value - end_fade_value)
        
        font_size_genre = min_genre_font_size + normalized_value * (max_genre_font_size_others - min_genre_font_size)
        alpha_genre = min_alpha + normalized_value * (max_alpha - min_alpha)

        # Garantir que os valores estejam dentro dos limites
        font_size_genre = max(min_genre_font_size, min(max_genre_font_size_others, font_size_genre))
        alpha_genre = max(min_alpha, min(max_alpha, alpha_genre))

    text_genre.set_fontsize(font_size_genre)
    text_genre.set_alpha(alpha_genre)
    text_genre.set_weight("bold")


    # Lógica para PORCENTAGENS
    if genre == "Pop":
        font_size_pct = pop_pct_font_size
        alpha_pct = max_alpha
    elif listeners >= start_fade_value:
        font_size_pct = max_pct_font_size_others
        alpha_pct = max_alpha
    elif listeners <= end_fade_value:
        font_size_pct = min_pct_font_size
        alpha_pct = min_alpha
    else:
        # Normalização para o intervalo de fade
        if (start_fade_value - end_fade_value) == 0:
            normalized_value = 0
        else:
            normalized_value = (listeners - end_fade_value) / (start_fade_value - end_fade_value)
        
        font_size_pct = min_pct_font_size + normalized_value * (max_pct_font_size_others - min_pct_font_size)
        alpha_pct = min_alpha + normalized_value * (max_alpha - min_alpha)
        
        # Garantir que os valores estejam dentro dos limites
        font_size_pct = max(min_pct_font_size, min(max_pct_font_size_others, font_size_pct))
        alpha_pct = max(min_alpha, min(max_alpha, alpha_pct))

    text_pct.set_fontsize(font_size_pct)
    text_pct.set_alpha(alpha_pct)
    text_pct.set_weight("bold")


ax1.axis('equal')  # Garante que o gráfico de pizza seja um círculo.

# Tamanho da fonte do título ajustado
plt.title('Distribuição de Ouvintes por Gênero Musical', fontsize=14, pad=20)

# Sem legenda

plt.tight_layout() # Ajusta o layout para evitar sobreposição


# Salvando o gráfico em um arquivo de imagem.
plt.savefig('gráfico.png')

# Exibir o gráfico
plt.show()


print("\nGráfico de pizza gerado com sucesso utilizando os dados do 'counter.json'!")
print("Todas as fatias de gênero foram incluídas, com nomes e porcentagens.")
print("O texto do gênero e sua opacidade variam conforme o número de ouvintes. O 'Pop' se destaca com o maior tamanho de fonte para nome e porcentagem.")
print(f"Gêneros como 'Rock', 'Hip Hop' etc. agora têm um tamanho de fonte maior para nomes e porcentagens.")
print(f"A opacidade total é mantida para gêneros com mais de {start_fade_value} ouvintes.")
print(f"A opacidade diminui linearmente de 100% para 0% para gêneros entre {start_fade_value} e {end_fade_value} ouvintes.")
print(f"Gêneros com {end_fade_value} ouvintes ou menos terão texto (nome e porcentagem) com opacidade próxima de zero.")
