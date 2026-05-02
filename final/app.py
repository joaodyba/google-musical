import os
import json
from flask import Flask, jsonify, request
from flask_cors import CORS
import firebase_admin
from firebase_admin import credentials, firestore
import matplotlib
matplotlib.use('Agg') # Importante: Usa o backend 'Agg' para gerar gráficos sem interface gráfica (GUI)
import matplotlib.pyplot as plt
import io
import base64
import datetime # Para timestamps serializáveis

app = Flask(__name__)
CORS(app) # Habilita CORS para todas as origens (importante para requisições do frontend)

# --- Inicialização do Firebase Admin SDK ---
try:
    # Verifica se serviceAccountKey.json existe. Este arquivo é essencial para a autenticação do Admin SDK.
    # Em um ambiente de produção, este arquivo geralmente seria carregado de variáveis de ambiente seguras.
    if not os.path.exists('serviceAccountKey.json'):
        print("[SERVER_ERROR] 'serviceAccountKey.json' não encontrado. Por favor, coloque-o no mesmo diretório do app.py.")
        # Considerar sair aqui se o Firebase for crítico: sys.exit(1)
    
    if not firebase_admin._apps: # Verifica se o app já foi inicializado para evitar erros
        cred = credentials.Certificate('serviceAccountKey.json')
        firebase_admin.initialize_app(cred)
    print("[SERVER] Firebase Admin SDK inicializado com sucesso.")
except Exception as e:
    print(f"[SERVER_ERROR] Erro ao inicializar o Firebase Admin SDK: {e}")
    # Se a inicialização do Firebase falhar, o backend não conseguirá interagir com o Firestore.
    # O aplicativo pode continuar rodando, mas as rotas que dependem do Firestore falharão.

db = firestore.client()

# --- Configuração do APP_ID ---
# Este APP_ID DEVE corresponder ao APP_ID usado no seu frontend (quiz.js e stats.js)
APP_ID = "cmcciencias-fba48" # Mantenha este ID consistente em todos os seus arquivos frontend!

# --- Funções Auxiliares para Normalização ---
def normalize_string_py(s):
    """
    Normaliza uma string para comparação consistente e uso como chave em dicionários:
    remove acentos, converte para minúsculas e remove espaços e alguns caracteres especiais.
    """
    if not isinstance(s, str):
        return ""
    # Python 3: normalize para NFD e remove caracteres combinados (acentos)
    normalized = (
        s.lower()
        .replace(" ", "") # Remove espaços
        .replace("-", "") # Remove hifens
        .replace("_", "") # Remove underscores (útil para tags)
    )
    import unicodedata
    normalized = "".join(
        c for c in normalized if unicodedata.category(c) != "Mn"
    )
    # Remove caracteres que não são letras ou números, mantendo apenas alfanuméricos
    normalized = "".join(filter(str.isalnum, normalized))
    return normalized

# --- Funções para Geração de Gráficos (Matplotlib) ---
def plot_difficulty_performance(difficulty_stats):
    print("[PLOT] Gerando gráfico de desempenho por dificuldade...")
    fig, ax = plt.subplots(figsize=(6, 3.5))  # Mantido o tamanho

    difficulties = ['Fácil', 'Médio', 'Difícil', 'Muito Difícil']
    correct_percentages = []

    for diff in difficulties:
        data = difficulty_stats.get(diff, {'answered': 0, 'correct': 0})
        percentage = (data['correct'] / data['answered']) * 100 if data['answered'] > 0 else 0
        correct_percentages.append(percentage)

    bars = ax.bar(difficulties, correct_percentages, color=['#4CAF50', '#8BC34A', '#FFC107', '#F44336'])
    ax.set_ylabel('% Acertos', fontsize=13)
    ax.set_title('Desempenho por Dificuldade', fontsize=14)
    ax.set_ylim(0, 100)

    for bar in bars:
        height = bar.get_height()
        ax.text(bar.get_x() + bar.get_width() / 2, height + 1.5, f"{height:.1f}%", ha='center', va='bottom', fontsize=12)

    plt.xticks(fontsize=12)
    plt.yticks(fontsize=12)

    buf = io.BytesIO()
    plt.savefig(buf, format='png', bbox_inches='tight', dpi=160)
    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode('utf-8')


def plot_top_songs(song_stats):
    print("[PLOT] Gerando gráfico das top 5 músicas mais acertadas...")
    fig, ax = plt.subplots(figsize=(7, 3.5))  # Mais largura para os nomes

    sorted_songs = sorted(song_stats.items(), key=lambda item: item[1].get('correct', 0), reverse=True)[:5]

    if not sorted_songs:
        ax.text(0.5, 0.5, "Nenhuma estatística de música disponível.",
                 ha='center', va='center', transform=ax.transAxes, fontsize=12)
        ax.axis('off')
        buf = io.BytesIO()
        plt.savefig(buf, format='png', bbox_inches='tight', dpi=160)
        plt.close(fig)
        return base64.b64encode(buf.getvalue()).decode('utf-8')

    song_labels = [s[0] for s in sorted_songs]
    correct_counts = [s[1].get('correct', 0) for s in sorted_songs]

    max_val = max(correct_counts) if correct_counts else 1
    xlim = max(3, max_val + 1)  # Limita o comprimento máximo das barras

    bars = ax.barh(song_labels, correct_counts, color='#4285F4')
    ax.set_xlabel('Acertos', fontsize=13)
    ax.set_title('Top 5 Músicas Mais Acertadas', fontsize=14)
    ax.invert_yaxis()
    ax.set_xlim(0, xlim)  # <-- Aqui está o ajuste importante

    for bar in bars:
        width = bar.get_width()
        ax.text(width + 0.2, bar.get_y() + bar.get_height() / 2, str(int(width)),
                ha='left', va='center', fontsize=12)

    plt.xticks(fontsize=12)
    plt.yticks(fontsize=11)

    fig.tight_layout()
    buf = io.BytesIO()
    plt.savefig(buf, format='png', bbox_inches='tight', dpi=180)
    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode('utf-8')

def plot_top_genres(genres_stats):
    print("[PLOT] Gerando gráfico dos top 5 gêneros mais acertados...")
    fig, ax = plt.subplots(figsize=(6, 3.5))

    sorted_genres = sorted(genres_stats.items(), key=lambda item: item[1].get('correct', 0), reverse=True)[:5]

    if not sorted_genres:
        ax.text(0.5, 0.5, "Nenhuma estatística de gênero disponível.",
                 ha='center', va='center', transform=ax.transAxes, fontsize=12)
        ax.axis('off')
        buf = io.BytesIO()
        plt.savefig(buf, format='png', bbox_inches='tight', dpi=180)
        plt.close(fig)
        return base64.b64encode(buf.getvalue()).decode('utf-8')

    genre_labels = [g[0] for g in sorted_genres]
    correct_counts = [g[1].get('correct', 0) for g in sorted_genres]

    bars = ax.barh(genre_labels, correct_counts, color='#34A853')
    ax.set_xlabel('Acertos', fontsize=13)
    ax.set_title('Top 5 Gêneros Mais Acertados', fontsize=14)
    ax.invert_yaxis()

    for bar in bars:
        width = bar.get_width()
        ax.text(width + 0.3, bar.get_y() + bar.get_height() / 2, str(int(width)),
                ha='left', va='center', fontsize=12)

    plt.xticks(fontsize=12)
    plt.yticks(fontsize=11)

    buf = io.BytesIO()
    plt.savefig(buf, format='png', bbox_inches='tight', dpi=180)
    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode('utf-8')

# --- Rotas da API ---
@app.route('/')
def index():
    """Rota raiz para verificar se o backend está rodando."""
    return "Backend do Google Musical Quiz está rodando."

@app.route('/api/global-quiz-stats', methods=['GET'])
def get_global_quiz_stats():
    """
    Agrega dados de todas as sessões de quiz para um APP_ID específico e retorna estatísticas globais,
    incluindo gráficos em Base64.
    Esta função percorre todos os documentos de utilizador para coletar os dados de quiz_sessions.
    """
    requested_app_id = request.args.get('app_id', APP_ID)
    print(f"[{request.path}] Recebida requisição para estatísticas globais para APP_ID: {requested_app_id}")

    # Validação simples do APP_ID
    if requested_app_id != APP_ID:
        print(f"[{request.path}] Erro: APP_ID '{requested_app_id}' na requisição não corresponde ao APP_ID configurado no servidor '{APP_ID}'.")
        return jsonify({"error": "APP_ID inválido."}), 400

    try:
        # Acessa a coleção de 'users' dentro do caminho 'artifacts/{app_id}'
        users_collection_ref = db.collection(f'artifacts/{requested_app_id}/users')
        
        # Obtém todos os documentos de usuários.
        # IMPORTANTE: Para que user_doc seja retornado por .stream(), o documento de usuário (e.g., /artifacts/appId/users/userId)
        # DEVE TER PELO MENOS UM CAMPO (não apenas subcoleções como 'quiz_sessions').
        # Garanta que seu código frontend (quiz.js) está escrevendo um campo diretamente no documento do usuário
        # (e.g., 'lastPlayed': FieldValue.serverTimestamp(), 'userId': userId).
        users_docs = users_collection_ref.stream()

        aggregated_stats = {
            'difficulty_stats': {
                'Fácil': {'answered': 0, 'correct': 0},
                'Médio': {'answered': 0, 'correct': 0},
                'Difícil': {'answered': 0, 'correct': 0},
                'Muito Difícil': {'answered': 0, 'correct': 0},
            },
            'song_stats': {}, # Key: "Artista - Música", Value: {'answered': int, 'correct': int}
            'genres_stats': {}, # Key: "Gênero", Value: {'answered': int, 'correct': int}
            'total_sessions': 0,
            'total_questions_answered': 0,
            'detailed_song_stats': {} # NOVO: Para armazenar detalhes de música por song_key
        }

        user_count = 0
        for user_doc in users_docs:
            user_count += 1
            user_id = user_doc.id
            print(f"[{request.path}] Processando dados para o usuário: {user_id}")

            # Acessa a subcoleção 'quiz_sessions' para cada usuário
            quiz_sessions_ref = db.collection(f'artifacts/{requested_app_id}/users/{user_id}/quiz_sessions')
            sessions = quiz_sessions_ref.stream()

            session_count = 0
            for session_doc in sessions:
                session_count += 1
                session_data = session_doc.to_dict()
                aggregated_stats['total_sessions'] += 1
                print(f"[{request.path}]   Processando sessão: {session_doc.id} (usuário: {user_id})")

                questions_attempted = session_data.get('questionsAttempted', [])
                aggregated_stats['total_questions_answered'] += len(questions_attempted)

                for q in questions_attempted:
                    # Estatísticas por dificuldade
                    difficulty = q.get('difficulty')
                    if difficulty and difficulty in aggregated_stats['difficulty_stats']:
                        aggregated_stats['difficulty_stats'][difficulty]['answered'] += 1
                        if q.get('correct'):
                            aggregated_stats['difficulty_stats'][difficulty]['correct'] += 1

                    # Estatísticas por música
                    song_name = q.get('song')
                    artist_name = q.get('artist')
                    if song_name and artist_name:
                        song_key = f"{artist_name} - {song_name}" # Mantém song_key para o plot
                        if song_key not in aggregated_stats['song_stats']:
                            aggregated_stats['song_stats'][song_key] = {'answered': 0, 'correct': 0}
                            # Armazena os detalhes da música a primeira vez que a encontramos
                            aggregated_stats['detailed_song_stats'][song_key] = {
                                'artist': artist_name,
                                'song': song_name
                            }
                            print(f"[APP_PY_DEBUG] Adicionado detalhes para {song_key}: Artista='{artist_name}', Música='{song_name}'") # DEBUG LOG
                        aggregated_stats['song_stats'][song_key]['answered'] += 1
                        if q.get('correct'):
                            aggregated_stats['song_stats'][song_key]['correct'] += 1

                    # Estatísticas por gênero (assume que 'genres' está salvo em questionsAttempted)
                    if q.get('genres') and isinstance(q['genres'], list):
                        for genre in q['genres']:
                            normalized_genre = normalize_string_py(genre)
                            if normalized_genre not in aggregated_stats['genres_stats']:
                                aggregated_stats['genres_stats'][normalized_genre] = {'answered': 0, 'correct': 0}
                            aggregated_stats['genres_stats'][normalized_genre]['answered'] += 1
                            if q.get('correct'):
                                aggregated_stats['genres_stats'][normalized_genre]['correct'] += 1
            
            print(f"[{request.path}]   Sessões processadas para o usuário {user_id}: {session_count}")

        print(f"[{request.path}] Total de usuários com documentos: {user_count}")
        if user_count == 0:
            print(f"[{request.path}] Aviso: Nenhum documento de usuário encontrado na coleção 'artifacts/{requested_app_id}/users'. Para que as estatísticas funcionem, os documentos de usuário precisam ter pelo menos um campo próprio (não apenas subcoleções).")
            # Adiciona dados de exemplo para os plots se não houver usuários, para que os gráficos ainda sejam gerados
            # Isso é útil para depuração e para que o frontend não fique vazio
            print("[PLOT_FALLBACK] Gerando dados de exemplo para plots, pois nenhum usuário foi encontrado.")
            aggregated_stats['difficulty_stats'] = {
                'Fácil': {'answered': 10, 'correct': 8},
                'Médio': {'answered': 15, 'correct': 10},
                'Difícil': {'answered': 8, 'correct': 3},
                'Muito Difícil': {'answered': 5, 'correct': 1},
            }
            aggregated_stats['song_stats'] = {
                'Artista A - Música X': {'answered': 5, 'correct': 4},
                'Artista B - Música Y': {'answered': 7, 'correct': 3},
                'Artista C - Música Z': {'answered': 6, 'correct': 5},
                'Artista D - Música W': {'answered': 4, 'correct': 2},
                'Artista E - Música K': {'answered': 3, 'correct': 3},
            }
            # Adiciona detalhes de músicas para os dados de exemplo também
            aggregated_stats['detailed_song_stats'] = {
                'Artista A - Música X': {'artist': 'Artista A', 'song': 'Música X'},
                'Artista B - Música Y': {'artist': 'Artista B', 'song': 'Música Y'},
                'Artista C - Música Z': {'artist': 'Artista C', 'song': 'Música Z'},
                'Artista D - Música W': {'artist': 'Artista D', 'song': 'Música W'},
                'Artista E - Música K': {'artist': 'Artista E', 'song': 'Música K'},
            }
            aggregated_stats['genres_stats'] = { # Adicionado dados de exemplo para gêneros
                'Rock': {'answered': 8, 'correct': 6},
                'Pop': {'answered': 12, 'correct': 9},
                'Jazz': {'answered': 5, 'correct': 4},
                'Blues': {'answered': 3, 'correct': 1},
                'Eletrônica': {'answered': 7, 'correct': 5},
            }


        print(f"[{request.path}] Estatísticas agregadas com sucesso para APP_ID: {requested_app_id}.")

        # --- Gerar gráficos em Base64 ---
        try:
            difficulty_plot_base64 = plot_difficulty_performance(aggregated_stats['difficulty_stats'])
            aggregated_stats['difficulty_plot_base64'] = difficulty_plot_base64
            print("[PLOT] Gráfico de dificuldade gerado e adicionado à resposta.")
        except Exception as plot_e:
            print(f"[PLOT_ERROR] Erro ao gerar gráfico de dificuldade: {plot_e}")
            aggregated_stats['difficulty_plot_base64'] = None

        try:
            top_songs_plot_base64 = plot_top_songs(aggregated_stats['song_stats'])
            aggregated_stats['top_songs_plot_base64'] = top_songs_plot_base64
            print("[PLOT] Gráfico de top músicas gerado e adicionado à resposta.")
        except Exception as plot_e:
            print(f"[PLOT_ERROR] Erro ao gerar gráfico de top músicas: {plot_e}")
            aggregated_stats['top_songs_plot_base64'] = None

        try:
            top_genres_plot_base64 = plot_top_genres(aggregated_stats['genres_stats']) # NOVO: Gerar plot de gêneros
            aggregated_stats['top_genres_plot_base64'] = top_genres_plot_base64 # NOVO: Adicionar à resposta
            print("[PLOT] Gráfico de top gêneros gerado e adicionado à resposta.")
        except Exception as plot_e:
            print(f"[PLOT_ERROR] Erro ao gerar gráfico de top gêneros: {plot_e}")
            aggregated_stats['top_genres_plot_base64'] = None
        
        # Adiciona um timestamp de última atualização serializável para o frontend
        aggregated_stats['last_updated'] = datetime.datetime.now().isoformat()
        
        return jsonify(aggregated_stats)

    except Exception as e:
        print(f"[{request.path}] ERRO CRÍTICO ao buscar ou agregar estatísticas para APP_ID {requested_app_id}: {e}")
        # Retorna um erro 500 com a mensagem de erro para o frontend
        return jsonify({"error": f"Erro interno do servidor: {str(e)}"}), 500

# Esta parte só é executada se você rodar o script diretamente (ex: python app.py)
if __name__ == '__main__':
    # Para produção, use um servidor WSGI como Gunicorn ou uWSGI
    # Ex: gunicorn -w 4 app:app
    app.run(debug=True) # Use debug=False em produção
