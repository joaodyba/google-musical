// --- Firebase Imports (TODAS as importações do Firebase SDK necessárias estão aqui) ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";


document.addEventListener('DOMContentLoaded', () => {
    console.log("[STATS_JS] DOM Content Loaded: Initializing stats.js script.");

    // --- Firebase Variables (Variáveis do Firebase) ---
    let db; // Instância do Firestore Database
    let auth; // Instância do Firebase Auth
    let userId; // ID do utilizador autenticado
    let appId; // ID da aplicação Firebase (definido pelo ambiente ou fallback)
    let initialAuthToken; // Token de autenticação inicial (se fornecido pelo ambiente)
    let firebaseInitialized = false; // Flag para controlar o estado de inicialização do Firebase

    // --- UI Elements (Elementos da Interface do Utilizador) ---
    const loadingMessage = document.getElementById('loading-message');
    const errorMessage = document.getElementById('error-message');
    const chartsSection = document.getElementById('charts-section'); // Contêiner pai dos gráficos

    // CORRIGIDO: Referências para os IDs corretos do HTML
    const topSongsPlotItem = document.getElementById('top-songs-plot-item'); 
    const topSongsPlot = document.getElementById('top-songs-plot');
    const topSongsList = document.getElementById('top-songs-list');
    
    // Lista de dificuldade permanece, mas será informada como "não ativada" no texto
    const rawStatsSection = document.getElementById('raw-stats-section');
    const lastUpdatedSpan = document.getElementById('last-updated');
    
    // CORRIGIDO: Referências para os IDs corretos do HTML para gêneros
    const topGenresPlotItem = document.getElementById('top-genres-plot-item');
    const topGenresPlot = document.getElementById('top-genres-plot');
    const topGenresList = document.getElementById('top-genres-list');


    // Custom Message Box Function (Função para exibir mensagens personalizadas)
    function showMessageBox(message) {
        const messageBox = document.getElementById('message-box');
        const messageBoxText = document.getElementById('message-box-text');
        if (messageBox && messageBoxText) {
            messageBoxText.textContent = message;
            messageBox.style.display = 'block';
        } else {
            console.warn("Message box elements not found. Falling back to console.log:", message);
        }
    }
    // A caixa de mensagens é esperada no HTML agora, então não adicionamos dinamicamente aqui.


    /**
     * Busca as estatísticas agregadas do backend Python e atualiza a UI.
     * Mostra/esconde as seções de gráficos e de texto conforme a disponibilidade dos dados.
     */
    async function fetchStatsFromServer() {
        console.log("[STATS_JS] Fetching stats from server...");
        loadingMessage.style.display = 'block'; // Mostra a mensagem de carregamento
        errorMessage.style.display = 'none'; // Esconde mensagens de erro
        
        // Esconde as seções de gráficos e de texto antes de carregar, para evitar informações desatualizadas
        chartsSection.style.display = 'none';
        topSongsPlotItem.style.display = 'none';
        topGenresPlotItem.style.display = 'none';
        rawStatsSection.style.display = 'none';

        try {
            // URL base do seu servidor Flask Python
            const PYTHON_SERVER_BASE_URL = 'http://127.0.0.1:5000'; 
            console.log(`[STATS_JS] Requesting stats from: ${PYTHON_SERVER_BASE_URL}/api/global-quiz-stats?app_id=${encodeURIComponent(appId)}`);

            const response = await fetch(`${PYTHON_SERVER_BASE_URL}/api/global-quiz-stats?app_id=${encodeURIComponent(appId)}`);
            
            if (!response.ok) {
                // Se a resposta não for OK (status 4xx ou 5xx), tenta ler a mensagem de erro do servidor
                const errorData = await response.json();
                throw new Error(`Server error (${response.status}): ${errorData.error || 'Unknown error'}`);
            }

            const stats = await response.json();
            console.log("[STATS_JS] Statistics received from server:", stats);

            // Agora, chartsSection se torna visível se qualquer um dos gráficos internos estiver presente.
            let anyChartAvailable = false;

            if (stats.top_songs_plot_base64) {
                topSongsPlot.src = `data:image/png;base64,${stats.top_songs_plot_base64}`; 
                topSongsPlotItem.style.display = 'block'; // Mostra o item do gráfico de top músicas
                anyChartAvailable = true;
            } else {
                topSongsPlot.src = '';
                topSongsPlotItem.style.display = 'none';
                console.warn("[STATS_JS] No top songs plot received from backend.");
            }

            if (stats.top_genres_plot_base64) {
                topGenresPlot.src = `data:image/png;base64,${stats.top_genres_plot_base64}`;
                topGenresPlotItem.style.display = 'block'; // Mostra o item do gráfico de gêneros
                anyChartAvailable = true;
            } else {
                topGenresPlot.src = '';
                topGenresPlotItem.style.display = 'none';
                console.warn("[STATS_JS] No top genres plot received from backend.");
            }
            
            if(anyChartAvailable) {
                chartsSection.style.display = 'block'; // Mostra a seção de gráficos se houver algum
            } else {
                chartsSection.style.display = 'none';
            }


            // Exibe as estatísticas em formato de texto
            displayRawStats(stats);
            // Só mostra a seção de estatísticas em texto se houver dados úteis para exibir
            if (Object.keys(stats.song_stats).length > 0 || Object.keys(stats.genres_stats).length > 0) {
                 rawStatsSection.style.display = 'block'; 
            } else {
                rawStatsSection.style.display = 'none';
            }


            loadingMessage.style.display = 'none'; // Esconde o loading
        } catch (error) {
            console.error("[STATS_JS_ERROR] Error fetching statistics from server:", error);
            loadingMessage.style.display = 'none';
            errorMessage.textContent = `Erro ao carregar estatísticas: ${error.message}. Tente novamente mais tarde.`;
            errorMessage.style.display = 'block';
            // Oculta todas as seções de dados se houver um erro crítico.
            chartsSection.style.display = 'none'; 
            topSongsPlotItem.style.display = 'none'; 
            topGenresPlotItem.style.display = 'none';
            rawStatsSection.style.display = 'none';
        }
    }

    /**
     * Exibe as estatísticas em formato de texto (listas).
     * @param {Object} stats As estatísticas agregadas a serem exibidas.
     */
    function displayRawStats(stats) {
        console.log("[STATS_JS] displayRawStats: detailed_song_stats recebido:", stats.detailed_song_stats); // DEBUG LOG: Verifica os detalhes da música

        // Atualiza o timestamp da última atualização
        if (stats.last_updated) {
            const date = new Date(stats.last_updated);
            lastUpdatedSpan.textContent = date.toLocaleString('pt-BR'); // Formato localizado
        } else {
            lastUpdatedSpan.textContent = 'N/A';
        }

        // Preenchimento do desempenho por dificuldade (mantido para a lista de texto, mas com mensagem)
        // A mensagem de que não está ativada é adicionada aqui, já que o backend não envia mais dados de dificuldade para plot
        const liNoDifficulty = document.createElement('li');
        liNoDifficulty.textContent = 'Estatísticas por dificuldade não estão ativadas.';



        // Preenche as músicas mais acertadas (Top 5)
        topSongsList.innerHTML = ''; // Limpa a lista existente
        // Pega as top músicas do song_stats, que ainda é indexado por "Artista - Música"
        const sortedSongs = Object.entries(stats.song_stats)
            .map(([key, value]) => ({ 
                songKey: key, // Mantém a chave original para referência
                correct: value.correct || 0, 
                answered: value.answered || 0 
            }))
            .sort((a, b) => b.correct - a.correct) // Ordena por número de acertos
            .slice(0, 5); // Pega apenas os 5 primeiros
        
        if (sortedSongs.length > 0) {
            sortedSongs.forEach(item => {
                const li = document.createElement('li');
                // Usa detailed_song_stats para obter o nome real da música e do artista
                const songDetails = stats.detailed_song_stats[item.songKey];
                let displayString;

                if (songDetails && songDetails.song && songDetails.artist) {
                    console.log(`[STATS_JS] Usando detalhes reais para ${item.songKey}: Música='${songDetails.song}', Artista='${songDetails.artist}'`); // DEBUG LOG
                    // Formato desejado: "Nome da Música do Artista X: Y acertos de Z"
                    displayString = `${songDetails.artist} - ${songDetails.song}: ${item.correct} acertos de ${item.answered}`;
                } else {
                    // Fallback se por algum motivo os detalhes não estiverem disponíveis
                    displayString = `${item.songKey}: ${item.correct} acertos de ${item.answered}`;
                    console.warn(`[STATS_JS] songDetails missing or incomplete for ${item.songKey}. Falling back to songKey display.`); // DEBUG LOG
                }
                li.textContent = displayString;
                topSongsList.appendChild(li);
            });
        } else {
            const li = document.createElement('li');
            li.textContent = 'Nenhuma estatística de música disponível.';
            topSongsList.appendChild(li);
        }

        // Preenche os gêneros mais acertados (Top 5)
        topGenresList.innerHTML = ''; // Limpa a lista existente
        const sortedGenres = Object.entries(stats.genres_stats)
            .map(([key, value]) => ({ genre: key, correct: value.correct || 0, answered: value.answered || 0 }))
            .sort((a, b) => b.correct - a.correct) // Ordena por número de acertos
            .slice(0, 5); // Pega apenas os 5 primeiros

        if (sortedGenres.length > 0) {
            sortedGenres.forEach(item => {
                const li = document.createElement('li');
                const percentage = item.answered > 0 ? ((item.correct / item.answered) * 100).toFixed(1) : 0;
                li.textContent = `${item.genre}: ${percentage}% de acertos (${item.correct}/${item.answered})`;
                topGenresList.appendChild(li);
            });
        } else {
            const li = document.createElement('li');
            li.textContent = 'Nenhuma estatística de gênero disponível.';
            topGenresList.appendChild(li);
        }
    }


    /**
     * Inicializa o Firebase e autentica o usuário (anónimo ou com token).
     * Após a autenticação, busca as estatísticas do servidor.
     */
    async function initializeFirebaseAndAuth() {
        console.log("[FIREBASE_INIT] Initializing Firebase...");

        // Tenta obter APP_ID, configuração e token do ambiente Canvas
        // Fallback para 'cmcciencias-fba48' se __app_id não estiver definido ou for vazio
        appId = typeof __app_id !== 'undefined' && __app_id.trim() !== '' ? __app_id : 'cmcciencias-fba48';
        let rawFirebaseConfig = typeof __firebase_config !== 'undefined' ? __firebase_config : null;
        initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

        let parsedFirebaseConfig = null;
        try {
            if (rawFirebaseConfig && rawFirebaseConfig.trim() !== '') {
                parsedFirebaseConfig = JSON.parse(rawFirebaseConfig);
            } else {
                console.warn("[FIREBASE_CONFIG_WARN] __firebase_config é nulo ou vazio. Usando fallback de configuração hardcoded.");
                // Fallback para uma configuração hardcoded, caso as variáveis do ambiente não estejam disponíveis
                parsedFirebaseConfig = {
                   apiKey: "AIzaSyB1pbjSgGNHJdMV8K_CAF1L7xqclmmTW4I",
                   authDomain: "cmcciencias-fba48.firebaseapp.com",
                   projectId: "cmcciencias-fba48",
                   storageBucket: "cmcciencias-fba48.firebasestorage.app",
                   messagingSenderId: "6765700731",
                   appId: "1:6765700731:web:721b72a007e8f7efe864de",
                   measurementId: "G-HTHEG0XDPE"
                };
            }
        } catch (e) {
            console.error("[FIREBASE_CONFIG_ERROR] Falha ao analisar __firebase_config como JSON:", e);
            showMessageBox("Firebase configuration error: Falha ao analisar JSON. Verifique o console para detalhes.");
            return; // Interrompe a inicialização se a configuração for inválida
        }

        try {
            const app = initializeApp(parsedFirebaseConfig);
            auth = getAuth(app);
            db = getFirestore(app);
            firebaseInitialized = true;
            console.log(`[FIREBASE_INIT_SUCCESS] Firebase App e Firestore inicializados. App ID: ${appId}`);

            // Listener para o estado de autenticação: garante que as estatísticas só são buscadas após o utilizador estar autenticado
            onAuthStateChanged(auth, async (user) => {
                if (user) {
                    userId = user.uid;
                    console.log(`[FIREBASE_AUTH] Usuário autenticado. UID: ${userId}`);
                } else {
                    console.log("[FIREBASE_AUTH] Nenhum usuário autenticado. Tentando autenticação anónima ou com token...");
                    try {
                        if (initialAuthToken) {
                            await signInWithCustomToken(auth, initialAuthToken);
                            userId = auth.currentUser.uid;
                            console.log(`[FIREBASE_AUTH_SUCCESS] Autenticado com token personalizado. UID: ${userId}`);
                        } else {
                            await signInAnonymously(auth);
                            userId = auth.currentUser.uid;
                            console.log(`[FIREBASE_AUTH_SUCCESS] Autenticado anonimamente. UID: ${userId}`);
                        }
                    } catch (error) {
                        console.error("[FIREBASE_AUTH_ERROR] Erro durante a autenticação anónima/token personalizado:", error);
                        showMessageBox("Firebase authentication error. Some features might not work. Check network connection and console.");
                        // Fallback para um UUID aleatório se a autenticação falhar, para que o app continue funcionando minimamente
                        userId = crypto.randomUUID(); 
                        console.warn(`[FIREBASE_AUTH_FALLBACK] Usando UUID aleatório como userId: ${userId}`);
                    }
                }
                console.log("[FIREBASE_AUTH] Authentication state changed. Fetching stats from server now.");
                await fetchStatsFromServer(); // Busca estatísticas do servidor após a autenticação
            });

        } catch (error) {
            console.error("[FIREBASE_INIT_ERROR] Global error during Firebase initialization:", error);
            showMessageBox("Erro crítico ao inicializar o Firebase. Algumas funcionalidades podem não funcionar. Verifique o console.");
        }
    }

    // Chama a função de inicialização do Firebase quando o DOM estiver completamente carregado
    console.log("[INIT] DOMContentLoaded finished. Calling initializeFirebaseAndAuth.");
    initializeFirebaseAndAuth();

    // Atualiza as estatísticas a cada 10 segundos buscando do servidor
    setInterval(async () => {
        if (firebaseInitialized && appId) { // Só tenta buscar se o Firebase estiver inicializado e o appId disponível
            console.log("[STATS_JS] Auto-refreshing stats from server...");
            await fetchStatsFromServer();
        } else {
            console.log("[STATS_JS] Skipping auto-refresh: Firebase not fully ready.");
        }
    }, 10000); // 10 segundos
});
