// --- Firebase Imports (TODAS as importações do Firebase SDK necessárias estão aqui) ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js";
// CORREÇÃO: Importa serverTimestamp e increment diretamente
import { getFirestore, collection, doc, addDoc, setDoc, updateDoc, getDoc, serverTimestamp, increment } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', () => {
    // --- Variáveis do Firebase (declaradas e inicializadas dentro deste escopo) ---
    let db;
    let auth;
    let userId; // userId será definido após a autenticação
    let appId;
    let initialAuthToken;
    let firebaseInitialized = false; // Flag para controlar a inicialização do Firebase

    // Custom Message Box Function
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

    // --- Existing Quiz Variables ---
    const urlParams = new URLSearchParams(window.location.search);
    const searchYear = urlParams.get('year');
    const freeTextQuery = urlParams.get('text');
    const tagsParam = urlParams.get('tags');
    const selectedTagsQuery = tagsParam ? tagsParam.split(',') : [];

    // Quiz sections
    const quizIntro = document.getElementById('quiz-intro');
    const quizExplanation = document.getElementById('quiz-explanation');
    const quizGame = document.getElementById('quiz-game');
    const quizResults = document.getElementById('quiz-results');

    // Buttons
    const exactMatchBtn = document.getElementById('exact-match-btn');
    const similarMatchBtn = document.getElementById('similar-match-btn');
    const randomBtn = document.getElementById('random-btn'); // Removed if not used, but keeping for now.
    const backToMainBtn = document.getElementById('back-to-main-btn'); // Removed if not used, but keeping for now.
    const startQuizBtn = document.getElementById('start-quiz-btn');
    const backToIntroBtn = document.getElementById('back-to-intro-btn'); // Removed if not used, but keeping for now.
    const playSnippetBtn = document.getElementById('play-snippet-btn');
    const moreTimeBtn = document.getElementById('more-time-btn');
    const nextQuestionBtn = document.getElementById('next-question-btn');
    const playAgainBtn = document.getElementById('play-again-btn');
    const backToMainFromResultsBtn = document.getElementById('back-to-main-from-results-btn');
    const endQuizBtn = document.getElementById('end-quiz-btn');

    // Display elements
    const explanationText = document.getElementById('explanation-text');
    const questionCounterDisplay = document.getElementById('question-counter');
    const scoreDisplay = document.getElementById('score-display');
    const difficultyDisplay = document.getElementById('difficulty-display');
    const questionText = document.getElementById('question-text');
    const audioPlayer = document.getElementById('audio-player');
    const answersContainer = document.getElementById('answers-container');
    const feedbackMessage = document.getElementById('feedback-message');
    const finalScoreDisplay = document.getElementById('final-score');

    // Global Stats Display Elements (from quiz.html, assumed to be here if needed)
    // Note: If these elements are only in stats.html, they won't be found here, which is fine.
    const globalStatsSection = document.getElementById('global-quiz-stats');
    const topCorrectSongsList = document.getElementById('top-correct-songs');
    const difficultyPerformanceList = document.getElementById('difficulty-performance');
    const topGenresList = document.getElementById('top-genres-list'); 
    const globalStatsLoading = document.getElementById('global-stats-loading');


    let allSongsForFiltering = [];
    let filteredQuizSongs = [];
    let currentQuizSongs = [];

    let score = 0;
    let questionsAnsweredThisSession = 0;
    let currentQuestion = null;
    let quizMode = null; // Unused but kept for context.
    let hasPlayedMoreTime = false;
    let questionsLog = [];
    
    // Timer variables (from previous quiz.js versions)
    let timer;
    let timeLeft;
    let currentSnippetDuration = 1.0; // Start with 1 second
    const MAX_SNIPPET_DURATION = 5.0; // Max 5 seconds
    const SNIPPET_INCREMENT = 0.5; // Increment by 0.5 seconds

    const DIFFICULTY_POINTS = {
        'Fácil': 1,
        'Médio': 2,
        'Difícil': 3,
        'Muito Difícil': 5
    };

    /**
     * Helper function to normalize strings for comparison.
     * Removes non-alphanumeric characters (except spaces/hyphens), converts to lowercase, and trims.
     * @param {string} str The string to normalize.
     * @returns {string} The normalized string.
     */
    function normalizeString(str) {
        if (!str) return '';
        return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                  .toLowerCase()
                  .replace(/[^\p{L}\p{N}\s-]/gu, '')
                  .replace(/\s+/g, ' ')
                  .trim();
    }

    /**
     * Exibe uma seção específica do quiz e oculta as outras.
     * @param {HTMLElement} sectionToShow A seção a ser exibida.
     */
    function showQuizSection(sectionToShow) {
        console.log(`[UI] Showing section: ${sectionToShow.id}`);
        quizIntro.style.display = 'none';
        quizExplanation.style.display = 'none';
        quizGame.style.display = 'none';
        quizResults.style.display = 'none';
        sectionToShow.style.display = 'block';
    }

    /**
     * Carrega e enriche os dados das músicas.
     * Carrega songs.json como base e enriche com caminhos de áudio de songs_enriched_deezer.json.
     * Filtra as músicas por ano, tags e texto livre da query.
     */
    async function loadSongs() {
        console.log("=== Starting loadSongs function ===");
        console.log(`URL Params: searchYear: "${searchYear}", freeTextQuery: "${freeTextQuery}", selectedTagsQuery: [${selectedTagsQuery.join(', ')}]`);

        try {
            // 1. Load songs.json
            console.log("--- Step 1: Fetching songs.json ---");
            const responseSongs = await fetch('songs.json');
            if (!responseSongs.ok) {
                console.error(`[ERROR] HTTP error! status: ${responseSongs.status} for songs.json. Text: ${responseSongs.statusText}`);
                showMessageBox(`Erro HTTP! Falha ao carregar songs.json: ${responseSongs.statusText}`);
                throw new Error(`Failed to load songs.json: ${responseSongs.statusText}`);
            }
            let baseSongs = await responseSongs.json();
            console.log(`[SUCCESS] Songs from songs.json loaded. Total: ${baseSongs.length}. First 5 songs:`, baseSongs.slice(0, 5));

            // 2. Load songs_enriched_deezer.json
            console.log("--- Step 2: Fetching songs_enriched_deezer.json ---");
            const responseDeezer = await fetch('songs_enriched_deezer.json');
            if (!responseDeezer.ok) {
                showMessageBox(`Erro HTTP! Falha ao carregar songs_enriched_deezer.json: ${responseDeezer.statusText}`);
                throw new Error(`HTTP error! status: ${responseDeezer.status} for songs_enriched_deezer.json. Text: ${responseDeezer.statusText}`);
            }
            const deezerSongs = await responseDeezer.json();
            console.log(`[SUCCESS] Songs with audio paths from songs_enriched_deezer.json loaded. Total: ${deezerSongs.length}. First 5 enriched songs:`, deezerSongs.slice(0, 5));

            // 3. Create audio path map for quick lookup using normalized keys
            console.log("--- Step 3: Creating audio path map ---");
            const audioPathMap = new Map();
            deezerSongs.forEach((s) => {
                const normalizedKey = `${normalizeString(s.artist)}-${normalizeString(s.song)}`;
                if (s.local_preview_path) {
                    audioPathMap.set(normalizedKey, { local_preview_path: s.local_preview_path, deezer_preview_url: s.deezer_preview_url });
                }
            });
            console.log(`[INFO] Audio path map created with ${audioPathMap.size} entries (only entries with local_preview_path and normalized keys).`);
            console.log("[DEBUG] Sample audioPathMap entries (first 5):", Array.from(audioPathMap.entries()).slice(0, 5));


            // 4. Enrich baseSongs and filter out those without valid audio paths
            console.log("--- Step 4: Enriching base songs with audio paths and filtering ---");
            let enrichedSongs = [];
            let songsWithoutAudio = [];
            baseSongs.forEach(song => {
                const normalizedKey = `${normalizeString(song.artist)}-${normalizeString(song.song)}`;
                const audioInfo = audioPathMap.get(normalizedKey);
                
                if (audioInfo && audioInfo.local_preview_path) {
                    enrichedSongs.push({ ...song, ...audioInfo, year: String(song.year) }); // Ensure year is string
                } else {
                    songsWithoutAudio.push(`${song.artist} - ${song.song} (Key: "${normalizedKey}", Year: ${song.year})`);
                }
            });
            allSongsForFiltering = enrichedSongs; // This is our final list of all playable songs
            
            console.log(`[RESULT] Songs successfully enriched with audio paths: ${allSongsForFiltering.length}`);
            if (songsWithoutAudio.length > 0) {
                console.warn(`[WARNING] Songs found in songs.json but without valid audio paths in songs_enriched_deezer.json: ${songsWithoutAudio.length} songs.`);
                console.warn("  [WARNING] Examples of songs skipped (first 10):", songsWithoutAudio.slice(0, 10));
                if (songsWithoutAudio.length > 10 && songsWithoutAudio.length < 100) {
                    console.warn("  [WARNING] All songs without audio paths (if < 100):", songsWithoutAudio);
                }
            }

            if (allSongsForFiltering.length === 0) {
                showMessageBox('Nenhuma música com pré-visualização de áudio válida foi encontrada após o carregamento e enriquecimento dos arquivos JSON. Por favor, verifique se songs.json e songs_enriched_deezer.json contêm músicas correspondentes com caminhos de áudio válidos.');
                console.error("Critical: No playable songs available after data loading and enrichment. Returning to intro.");
                showQuizSection(quizIntro);
                return;
            }

            // --- Query Parsing and Filtering Logic ---
            console.log("--- Step 5: Parsing URL parameters for filtering ---");
            let queryTags = [];
            let freeTextQueryParts = [];
            let hasYearQuery = !!searchYear;
            let hasTagQuery = selectedTagsQuery.length > 0;
            let hasFreeTextQuery = false;

            queryTags = selectedTagsQuery.map(tag => normalizeString(tag));
            const uniqueCombinedSearchTags = [...new Set(queryTags.filter(tag => tag.length > 0))];
            if (uniqueCombinedSearchTags.length > 0) {
                hasTagQuery = true;
            }

            if (freeTextQuery) {
                freeTextQueryParts = freeTextQuery.split(/\s+/).filter(part => part.length > 0).map(part => normalizeString(part));
                if (freeTextQueryParts.length > 0) {
                    hasFreeTextQuery = true;
                }
            }
            
            console.log(`\n--- Parsed Query (from direct parameters) ---`);
            console.log(`  Search Year (if present): "${searchYear || 'N/A'}" (hasYearQuery: ${hasYearQuery})`);
            console.log(`  Combined Search Tags (normalized & unique): [${uniqueCombinedSearchTags.join(', ')}] (hasTagQuery: ${hasTagQuery})`);
            console.log(`  Free Text Parts (normalized): [${freeTextQueryParts.join(' ')}] (hasFreeTextQuery: ${hasFreeTextQuery})`);
            const anyFilterApplied = hasYearQuery || hasTagQuery || hasFreeTextQuery;
            console.log(`  Any filter criteria applied: ${anyFilterApplied}`);
            console.log(`--- End Parsed Query ---\n`);

            console.log("--- Step 6: Filtering songs based on parsed query ---");
            filteredQuizSongs = allSongsForFiltering.filter((song, index) => {
                let meetsYearCriteria = true;
                if (hasYearQuery) {
                    const normalizedSongYear = normalizeString(String(song.year));
                    const normalizedSearchYear = normalizeString(searchYear);
                    meetsYearCriteria = normalizedSongYear === normalizedSearchYear;
                    console.log(`    [DEBUG_YEAR] Comparing song.year "${song.year}" (normalized: "${normalizedSongYear}") with searchYear "${normalizedSearchYear}" -> Match: ${meetsYearCriteria}`);
                }

                let meetsTagsCriteria = true;
                if (hasTagQuery) {
                    const allSongTags = [
                        ...(song.genres || []).map(tag => normalizeString(tag)),
                        ...(song.styles || []).map(tag => normalizeString(tag))
                    ];
                    meetsTagsCriteria = uniqueCombinedSearchTags.every(queryTag => allSongTags.includes(queryTag));
                }

                let meetsFreeTextCriteria = true;
                if (hasFreeTextQuery) {
                    const songArtist = normalizeString(song.artist);
                    const songTitle = normalizeString(song.song);
                    meetsFreeTextCriteria = freeTextQueryParts.every(part =>
                        songArtist.includes(part) || songTitle.includes(part)
                    );
                }

                let overallMatch = true;
                if (anyFilterApplied) {
                    if (hasYearQuery) overallMatch = overallMatch && meetsYearCriteria;
                    if (hasTagQuery) overallMatch = overallMatch && meetsTagsCriteria;
                    if (hasFreeTextQuery) overallMatch = overallMatch && meetsFreeTextCriteria;
                } else {
                    overallMatch = true;
                }
                
                if (overallMatch) {
                    console.log(`[FILTER_LOG] Song #${index + 1}: "${song.artist} - ${song.song}" (Original Year: ${song.year}, Genres: [${song.genres?.join(', ')}], Styles: [${song.styles?.join(', ')}])`);
                    if (hasYearQuery) console.log(`  - Year "${searchYear}" match: ${meetsYearCriteria}`);
                    if (hasTagQuery) console.log(`  - Tags "[${uniqueCombinedSearchTags.join(', ')}]" match: ${meetsTagsCriteria}`);
                    if (hasFreeTextQuery) console.log(`  - Free Text "[${freeTextQueryParts.join(' ')}]" match: ${meetsFreeTextCriteria}`);
                    console.log(`  - Overall Match for this song: ${overallMatch}\n`);
                }
                return overallMatch;
            });

            console.log(`[RESULT] Initial filtered songs based on query: ${filteredQuizSongs.length} songs.`);

            // Fallback para todas as músicas se os filtros resultarem em zero músicas
            console.log("--- Step 7: Checking for fallback logic ---");
            if (filteredQuizSongs.length === 0 && allSongsForFiltering.length > 0 && anyFilterApplied) {
                let filterDetails = [];
                if (hasYearQuery) filterDetails.push(`ano: "${searchYear}"`);
                if (hasTagQuery) filterDetails.push(`tags: "${uniqueCombinedSearchTags.join(', ')}"`);
                if (hasFreeTextQuery) filterDetails.push(`texto livre: "${freeTextQueryParts.join(' ')}"`);
                
                showMessageBox(`Nenhuma música encontrada que corresponda a TODOS os filtros especificados (${filterDetails.join(' e ')}). O quiz usará todas as músicas válidas (com áudio) para gerar perguntas.`);
                filteredQuizSongs = [...allSongsForFiltering]; // Fallback para todas as músicas válidas (com áudio)
                console.log(`[FALLBACK] Fallback to all playable songs. Total: ${filteredQuizSongs.length} songs.`);
            } else if (allSongsForFiltering.length === 0) {
                showMessageBox('O arquivo songs.json pode estar vazio ou nenhuma música com pré-visualização de áudio válida foi encontrada. Não há músicas para o quiz.');
                console.error("Critical: No playable songs available even after fallbacks. Check initial data files. Returning to intro.");
                showQuizSection(quizIntro);
            }

            console.log(`[FINAL_RESULT] Final songs available for quiz after all filtering and fallbacks. Count: ${filteredQuizSongs.length}`);
            console.log("=== loadSongs function finished ===");

        } catch (error) {
            console.error('[GLOBAL_ERROR] Error loading and filtering songs:', error);
            showMessageBox('Erro ao carregar e filtrar as músicas para o quiz. Por favor, tente novamente.');
            showQuizSection(quizIntro);
        }
    }


    /**
     * Gera uma nova pergunta do quiz com dificuldade variada.
     * @returns {Object|null} O objeto da pergunta ou null se não houver músicas disponíveis.
     */
    function generateQuestion() {
        console.log("=== Starting generateQuestion function ===");
        console.log(`[GEN_Q] filteredQuizSongs count: ${filteredQuizSongs.length}`);

        if (filteredQuizSongs.length === 0) {
            console.warn("[GEN_Q] No songs available to generate questions. Returning null.");
            return null;
        }

        // Evita repetir músicas no curto prazo, mas permite reuso para quiz infinito
        let availableSongs = filteredQuizSongs.filter(song =>
            !currentQuizSongs.some(q => normalizeString(q.artist) === normalizeString(song.artist) && normalizeString(q.song) === normalizeString(song.song))
        );
        console.log(`[GEN_Q] Available unique songs (after avoiding current session repeats): ${availableSongs.length}`);


        if (availableSongs.length === 0) {
            console.log("[GEN_Q] Ran out of unique songs for current session, resetting currentQuizSongs.");
            currentQuizSongs = []; // Reseta se todas as músicas filtradas foram usadas
            availableSongs = filteredQuizSongs; // Usa todas as músicas filtradas novamente
            console.log(`[GEN_Q] Available songs after reset: ${availableSongs.length}`);
        }

        // Distribuição de dificuldade
        const rand = Math.random();
        let difficulty = 'Fácil'; // Padrão
        if (rand < 0.05) { // 5%
            difficulty = 'Muito Difícil';
        } else if (rand < 0.15) { // 10% para Difícil (0.05 + 0.10)
            difficulty = 'Difícil';
        } else if (rand < 0.40) // 25% para Médio (0.15 + 0.25)
        {
            difficulty = 'Médio';
        }
        console.log(`[GEN_Q] Random difficulty selected: ${difficulty}`);

        // Seleciona uma música aleatória para a pergunta
        const questionSongIndex = Math.floor(Math.random() * availableSongs.length);
        const questionSong = availableSongs[questionSongIndex];
        console.log(`[GEN_Q] Selected question song: "${questionSong.artist} - ${questionSong.song}"`);

        // Garante que a música selecionada tem um caminho de áudio
        if (!questionSong || !questionSong.local_preview_path) {
            console.warn(`[GEN_Q_WARN] Selected song "${questionSong?.artist} - ${questionSong?.song}" has no local_preview_path or is null. Trying to generate another question.`);
            return generateQuestion(); // Tenta novamente (irá escolher outra música)
        }
        
        // Coleta outras respostas possíveis (do songs.json)
        // Certifica-se de que as opções de resposta também têm audio path válido
        const allPossibleAnswers = allSongsForFiltering.filter(song =>
            normalizeString(song.song) !== normalizeString(questionSong.song) && song.local_preview_path
        );
        console.log(`[GEN_Q] Total possible incorrect answers: ${allPossibleAnswers.length}`);


        const answers = [{
            text: `${questionSong.artist} - ${questionSong.song}`,
            isCorrect: true,
            id: `${normalizeString(questionSong.artist)}-${normalizeString(questionSong.song)}`
        }];
        console.log(`[GEN_Q] Added correct answer: "${answers[0].text}"`);

        // Lógica para adicionar 3 respostas incorretas com base no quizMode
        const tempPossibleAnswers = [...allPossibleAnswers]; // Cria uma cópia para modificação local
        
        if (quizMode === 'similar') {
            console.log("[GEN_Q] Generating similar incorrect answers.");
            const targetString = normalizeString(`${questionSong.artist} ${questionSong.song}`);
            const similarSongs = [];
            
            // Collect similar songs
            for (let i = 0; i < tempPossibleAnswers.length; i++) {
                const candidateSong = tempPossibleAnswers[i];
                const candidateString = normalizeString(`${candidateSong.artist} ${candidateSong.song}`);
                const distance = levenshteinDistance(targetString, candidateString);
                
                // Define a range for "similarity" (e.g., Levenshtein distance between 3 and 7)
                if (distance >= 3 && distance <= 7) { // Adjusted range for potentially better "similar" feel
                    similarSongs.push({ song: candidateSong, distance: distance, originalIndex: i });
                }
            }
            
            // Sort by distance (closer is more similar, but avoid too close) and take top ones
            similarSongs.sort((a, b) => a.distance - b.distance); // Closer distance first
            
            let similarCount = 0;
            while (answers.length < 4 && similarSongs.length > 0) {
                const selectedSimilar = similarSongs.shift(); // Take the most similar first
                const incorrectSong = selectedSimilar.song;

                const incorrectSongId = `${normalizeString(incorrectSong.artist)}-${normalizeString(incorrectSong.song)}`;
                if (!answers.some(a => a.id === incorrectSongId)) {
                    answers.push({
                        text: `${incorrectSong.artist} - ${incorrectong.song}`,
                        isCorrect: false,
                        id: incorrectSongId
                    });
                    console.log(`[GEN_Q] Added similar incorrect answer: "${incorrectSong.artist} - ${incorrectSong.song}" (Distance: ${selectedSimilar.distance})`);
                    similarCount++;
                }
            }
            console.log(`[GEN_Q] Added ${similarCount} similar incorrect answers.`);

            // If not enough similar answers were found, fall back to random
            while (answers.length < 4 && tempPossibleAnswers.length > 0) {
                const randomIndex = Math.floor(Math.random() * tempPossibleAnswers.length);
                const incorrectSong = tempPossibleAnswers[randomIndex];

                const incorrectSongId = `${normalizeString(incorrectSong.artist)}-${normalizeString(incorrectSong.song)}`;
                if (!answers.some(a => a.id === incorrectSongId)) {
                    answers.push({
                        text: `${incorrectSong.artist} - ${incorrectSong.song}`,
                        isCorrect: false,
                        id: incorrectSongId
                    });
                    console.log(`[GEN_Q] Added random fallback incorrect answer: "${incorrectSong.artist} - ${incorrectSong.song}"`);
                }
                tempPossibleAnswers.splice(randomIndex, 1);
            }

        } else { // Default or 'random' mode: pick randomly
            while (answers.length < 4 && tempPossibleAnswers.length > 0) {
                const randomIndex = Math.floor(Math.random() * tempPossibleAnswers.length);
                const incorrectSong = tempPossibleAnswers[randomIndex];

                // Evita adicionar opções de resposta duplicadas usando IDs normalizados
                const incorrectSongId = `${normalizeString(incorrectSong.artist)}-${normalizeString(incorrectSong.song)}`;
                if (!answers.some(a => a.id === incorrectSongId)) {
                    answers.push({
                        text: `${incorrectSong.artist} - ${incorrectSong.song}`,
                        isCorrect: false,
                        id: incorrectSongId
                    });
                    console.log(`[GEN_Q] Added random incorrect answer: "${incorrectSong.artist} - ${incorrectSong.song}"`);
                }
                tempPossibleAnswers.splice(randomIndex, 1);
            }
        }

        console.log(`[GEN_Q] Answers array before shuffle (count: ${answers.length}):`, answers.map(a => a.text));

        // Embaralha as respostas
        for (let i = answers.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [answers[i], answers[j]] = [answers[j], answers[i]];
        }
        console.log(`[GEN_Q] Answers array after shuffle:`, answers.map(a => a.text));

        currentQuizSongs.push(questionSong);
        console.log(`[GEN_Q] currentQuizSongs count: ${currentQuizSongs.length}`);

        console.log("=== generateQuestion function finished ===");
        return {
            song: questionSong,
            audioPath: questionSong.local_preview_path,
            answers: answers,
            difficulty: difficulty,
            points: DIFFICULTY_POINTS[difficulty]
        };
    }

    /**
     * Exibe a pergunta atual na UI.
     */
    function displayQuestion() {
        console.log("=== Starting displayQuestion function ===");
        console.log(`[DISPLAY_Q] filteredQuizSongs count before generating question: ${filteredQuizSongs.length}`);

        if (filteredQuizSongs.length === 0) {
            console.error("[DISPLAY_Q_ERROR] No songs available for the quiz. Displaying alert and returning to intro.");
            showMessageBox('Não há músicas disponíveis para o quiz. Por favor, carregue os arquivos de músicas.');
            showQuizSection(quizIntro);
            return;
        }

        currentQuestion = generateQuestion();
        if (!currentQuestion) {
            console.error("[DISPLAY_Q_ERROR] Failed to generate a new question. Displaying alert and returning to intro.");
            showMessageBox('Não foi possível gerar uma nova pergunta. Tentando novamente ou encerrando o quiz.');
            showQuizSection(quizIntro);
            return;
        }
        console.log("[DISPLAY_Q] Current question object:", currentQuestion);

        questionsAnsweredThisSession++;
        questionCounterDisplay.textContent = `Questão ${questionsAnsweredThisSession}`;
        scoreDisplay.textContent = `Pontuação: ${score}`;
        difficultyDisplay.textContent = `Dificuldade: ${currentQuestion.difficulty} (${currentQuestion.points} pts)`;
        questionText.textContent = `Qual é a música?`;

        audioPlayer.src = currentQuestion.audioPath;
        console.log(`[DISPLAY_Q] Setting audio source to: ${audioPlayer.src}`);
        audioPlayer.load();
        audioPlayer.currentTime = 1; // Sempre começa a tocar a partir de 1 segundo
        console.log("[DISPLAY_Q] Audio player loaded and reset. Start time set to 1s.");

        answersContainer.innerHTML = '';
        currentQuestion.answers.forEach((answer, index) => {
            const button = document.createElement('button');
            button.classList.add('answer-btn');
            button.textContent = answer.text;
            button.dataset.isCorrect = answer.isCorrect;
            button.dataset.songId = answer.id;
            button.addEventListener('click', () => {
                console.log(`[USER_ACTION] Answer button clicked: "${answer.text}" (Correct: ${answer.isCorrect})`);
                checkAnswer(button);
            });
            answersContainer.appendChild(button);
            console.log(`[DISPLAY_Q] Rendered answer button #${index + 1}: "${answer.text}"`);
        });

        feedbackMessage.textContent = '';
        nextQuestionBtn.style.display = 'none';
        // Atualiza o texto do botão de snippet para refletir a duração acumulada
        playSnippetBtn.textContent = `Tocar ${currentSnippetDuration.toFixed(1)}s`;
        moreTimeBtn.disabled = false;
        hasPlayedMoreTime = false;
        console.log("=== displayQuestion function finished ===");
    }

    /**
     * Verifica a resposta selecionada e atualiza a pontuação.
     * @param {HTMLButtonElement} selectedButton O botão que foi clicado.
     */
    function checkAnswer(selectedButton) {
        console.log("=== Starting checkAnswer function ===");
        const isCorrect = selectedButton.dataset.isCorrect === 'true';
        const questionSongId = `${normalizeString(currentQuestion.song.artist)}-${normalizeString(currentQuestion.song.song)}`;
        console.log(`[CHECK_ANSWER] User selected: "${selectedButton.textContent}". Is correct: ${isCorrect}`);
        console.log(`[CHECK_ANSWER] Correct song ID: "${questionSongId}"`);

        // Desabilita todos os botões de resposta depois que um é selecionado
        Array.from(answersContainer.children).forEach(button => {
            button.disabled = true;
            if (button.dataset.isCorrect === 'true') {
                button.classList.add('correct');
                console.log(`[CHECK_ANSWER] Marked correct button: "${button.textContent}"`);
            } else if (button === selectedButton) {
                button.classList.add('wrong');
                console.log(`[CHECK_ANSWER] Marked selected (wrong) button: "${button.textContent}"`);
            }
        });

        if (isCorrect) {
            score += currentQuestion.points;
            feedbackMessage.textContent = `Correto! +${currentQuestion.points} pontos.`;
            feedbackMessage.style.color = '#4CAF50';
            console.log(`[CHECK_ANSWER] Correct answer. Score updated to: ${score}`);
        } else {
            feedbackMessage.textContent = 'Errado!';
            feedbackMessage.style.color = '#f44336';
            console.log(`[CHECK_ANSWER] Incorrect answer. Score remains: ${score}`);
        }
        scoreDisplay.textContent = `Pontuação: ${score}`;

        // Log da tentativa de pergunta para a sessão
        const logEntry = {
            song: currentQuestion.song.song,
            artist: currentQuestion.song.artist,
            year: currentQuestion.song.year,
            difficulty: currentQuestion.difficulty,
            correct: isCorrect,
            answeredAt: new Date().toISOString(),
            genres: currentQuestion.song.genres || [] // Certifica-se de que os gêneros são incluídos
        };
        questionsLog.push(logEntry);
        console.log("[CHECK_ANSWER] Question logged:", logEntry);

        // Atualiza as estatísticas globais do quiz no Firebase Firestore
        console.log("[CHECK_ANSWER] Attempting to update global quiz stats for song, difficulty, and genres...");
        updateGlobalQuizStats(currentQuestion.song, currentQuestion.difficulty, isCorrect);

        nextQuestionBtn.style.display = 'block';
        audioPlayer.pause();
        console.log("=== checkAnswer function finished ===");
    }

    // Levenshtein Distance for similarity checking (kept for completeness, though not actively used in the current flow)
    function levenshteinDistance(a, b) {
        const matrix = [];
        for (let i = 0; i <= b.length; i++) {
            matrix[i] = [i];
        }
        for (let j = 0; j <= a.length; j++) {
            matrix[0][j] = j;
        }
        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                const cost = a[j - 1] === b[i - 1] ? 0 : 1;
                matrix[i][j] = Math.min(
                    matrix[i - 1][j] + 1,      // Deletion
                    matrix[i][j - 1] + 1,      // Insertion
                    matrix[i - 1][j - 1] + cost // Substitution
                );
            }
        }
        return matrix[b.length][a.length];
    }

    /**
     * Salva os detalhes da sessão atual do quiz no Firebase Firestore.
     */
    async function saveQuizSession() {
        console.log("=== Starting saveQuizSession function ===");
        if (!firebaseInitialized || typeof db === 'undefined' || typeof userId === 'undefined') {
            console.warn("[SAVE_SESSION_WARN] Firebase not fully initialized or 'db'/'userId' not available. Skipping save quiz session.");
            return;
        }
        if (questionsLog.length === 0) {
            console.log("[SAVE_SESSION_INFO] No questions answered in this session. Skipping save.");
            return;
        }
        console.log("[SAVE_SESSION] Firebase 'db' and 'userId' are available. questionsLog count:", questionsLog.length);

        try {
            // Garante que o documento do usuário exista com pelo menos um campo
            // Isso é crucial para que o app.py possa "enxergar" o documento do usuário.
            const userDocRef = doc(db, `artifacts/${appId}/users/${userId}`);
            await setDoc(userDocRef, { 
                lastAccessed: serverTimestamp(), // Corrigido
                userId: userId // Adiciona o userId como um campo direto também
            }, { merge: true }); // Usar merge:true para não sobrescrever outros campos se existirem

            // Salva os resultados da sessão do quiz na subcoleção 'quiz_sessions'
            const quizSessionCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/quiz_sessions`);
            await addDoc(quizSessionCollectionRef, {
                timestamp: serverTimestamp(), // Corrigido
                totalQuestions: questionsLog.length, // Usar questionsLog.length para total de perguntas respondidas
                finalScore: score,
                questionsAttempted: questionsLog
            });
            console.log("[SAVE_SESSION_SUCCESS] Quiz session saved successfully to Firestore!");
            showMessageBox("Sessão do quiz salva online com sucesso!");
        } catch (error) {
            console.error("[SAVE_SESSION_ERROR] Erro ao salvar a sessão do quiz online:", error);
            showMessageBox("Erro ao salvar a sessão do quiz online. Tente novamente mais tarde.");
        } finally {
            console.log("=== saveQuizSession function finished ===");
        }
    }

    /**
     * Updates global aggregated quiz statistics in Firebase Firestore.
     * Uses atomic increments to handle concurrent updates.
     * @param {Object} song The song object.
     * @param {string} difficulty The difficulty level.
     * @param {boolean} isCorrect Whether the answer was correct.
     */
    async function updateGlobalQuizStats(song, difficulty, isCorrect) {
        console.log("=== Starting updateGlobalQuizStats function ===");
        if (!firebaseInitialized || typeof db === 'undefined' || typeof appId === 'undefined') { // Adicionado check para appId
            console.warn("[UPDATE_STATS_WARN] Firebase not fully initialized, 'db' or 'appId' not available. Skipping global stats update.");
            return;
        }
        console.log(`[UPDATE_STATS] Firebase 'db' and 'appId' (${appId}) are available.`);

        try {
            const statsDocRef = doc(db, `artifacts/${appId}/public/data/quiz_stats/global_stats`);
            console.log(`[UPDATE_STATS] Firestore document path: ${statsDocRef.path}`); // Log do caminho completo

            let updateData = {};

            // 1. Update difficulty stats
            const difficultyPathAnswered = `difficulty_stats.${difficulty}.answered`;
            const difficultyPathCorrect = `difficulty_stats.${difficulty}.correct`;
            updateData[difficultyPathAnswered] = increment(1); // Corrigido
            if (isCorrect) {
                updateData[difficultyPathCorrect] = increment(1); // Corrigido
            }
            console.log(`[UPDATE_STATS] Difficulty update data: ${difficultyPathAnswered}: +1, ${difficultyPathCorrect}: ${isCorrect ? '+1' : '+0'}`);

            // 2. Update song stats
            const songKey = `${song.artist} - ${song.song}`; // Usa os nomes reais, sem normalizar para a chave
            const songPathAnswered = `song_stats.${songKey}.answered`;
            const songPathCorrect = `song_stats.${songKey}.correct`;
            updateData[songPathAnswered] = increment(1); // Corrigido
            if (isCorrect) {
                updateData[songPathCorrect] = increment(1); // Corrigido
            }
            console.log(`[UPDATE_STATS] Song update data for "${songKey}": ${songPathAnswered}: +1, ${songPathCorrect}: ${isCorrect ? '+1' : '+0'}`);
            // Adiciona ou atualiza os detalhes da música para a chave real
            updateData[`detailed_song_stats.${songKey}`] = { artist: song.artist, song: song.song };


            // 3. Update genre stats
            if (song.genres && song.genres.length > 0) {
                console.log("[UPDATE_STATS] Processing genres for update...");
                song.genres.forEach(genre => {
                    const normalizedGenre = normalizeString(genre); // Normaliza o gênero para a chave
                    const genrePathAnswered = `genres_stats.${normalizedGenre}.answered`;
                    const genrePathCorrect = `genres_stats.${normalizedGenre}.correct`;
                    
                    updateData[genrePathAnswered] = increment(1); // Corrigido
                    if (isCorrect) {
                        updateData[genrePathCorrect] = increment(1); // Corrigido
                    }
                    console.log(`[UPDATE_STATS] Genre update data for "${normalizedGenre}": ${genrePathAnswered}: +1, ${genrePathCorrect}: ${isCorrect ? '+1' : '+0'}`);
                });
            } else {
                console.warn("[UPDATE_STATS_WARN] Song has no genres to update statistics for:", song);
            }

            console.log("[UPDATE_STATS] Data being sent for update:", updateData);

            // Use setDoc com merge:true para criar o documento se não existir e atualizar se existir
            await setDoc(statsDocRef, updateData, { merge: true });
            console.log("[UPDATE_STATS_SUCCESS] Global quiz stats updated/created in Firestore.");
        } catch (error) {
            console.error("[UPDATE_STATS_ERROR] Error updating global quiz stats in Firestore:", error);
            // Mostrar mensagem de erro na UI para o usuário, se necessário
            showMessageBox(`Erro ao atualizar estatísticas globais: ${error.message}.`);
        } finally {
            console.log("=== updateGlobalQuizStats function finished ===");
        }
    }


    // --- Quiz Flow Management ---

    function startQuiz(mode) {
        console.log(`[QUIZ_FLOW] Starting quiz in mode: ${mode}`);
        quizMode = mode;
        score = 0;
        questionsAnsweredThisSession = 0;
        questionsLog = [];
        currentSnippetDuration = 1.0; // Reset snippet duration for new quiz
        displayQuestion();
        showQuizSection(quizGame);
    }

    async function endQuizSession() {
        console.log("[QUIZ_FLOW] Ending quiz session.");
        audioPlayer.pause();
        finalScoreDisplay.textContent = `${score} pontos em ${questionsAnsweredThisSession} perguntas.`;
        showQuizSection(quizResults);
        await saveQuizSession(); // Save session results
    }


    // --- Event Listeners ---
    if (exactMatchBtn) {
        exactMatchBtn.addEventListener('click', () => {
            // No freeTextMode concept in current version, just start the quiz
            startQuiz('exact-match');
        });
    }

    if (similarMatchBtn) {
        similarMatchBtn.addEventListener('click', () => {
            startQuiz('similar')
        })
    }

    // Add event listener for randomBtn
    if (randomBtn) {
        randomBtn.addEventListener('click', () => {
            startQuiz('random');
        });
    }

    // if (timeTrialBtn) { // Assumed this button exists from older versions
    //     timeTrialBtn.addEventListener('click', () => {
    //         startQuiz('time-trial');
    //     });
    // }

    // if (submitAnswerBtn) { // Assumed this button exists from older versions
    //     // submitAnswerBtn.addEventListener('click', checkAnswer);
    // }
    // if (answerInput) { // Assumed this input exists from older versions
    //     // answerInput.addEventListener('keypress', (e) => {
    //     //     if (e.key === 'Enter') {
    //     //         checkAnswer();
    //     //     }
    //     // });
    // }

    if (nextQuestionBtn) {
        nextQuestionBtn.addEventListener('click', () => {
            displayQuestion();
        });
    }

    if (playSnippetBtn) {
        playSnippetBtn.addEventListener('click', () => {
            console.log(`[AUDIO] Playing snippet for ${currentSnippetDuration}s.`);
            audioPlayer.currentTime = 1; // Always start from 1s mark for snippet
            audioPlayer.play().catch(e => console.error("Error playing audio:", e));
            setTimeout(() => {
                audioPlayer.pause();
            }, currentSnippetDuration * 1000);
        });
    }

    if (moreTimeBtn) {
        moreTimeBtn.addEventListener('click', () => {
            if (currentSnippetDuration < MAX_SNIPPET_DURATION) {
                currentSnippetDuration = Math.min(MAX_SNIPPET_DURATION, currentSnippetDuration + SNIPPET_INCREMENT);
                playSnippetBtn.textContent = `Tocar ${currentSnippetDuration.toFixed(1)}s`;
                console.log(`[AUDIO] Snippet duration increased to ${currentSnippetDuration.toFixed(1)}s.`);
            } else {
                moreTimeBtn.disabled = true; // Disable if max duration reached
                console.log("[AUDIO] Max snippet duration reached.");
            }
        });
    }

    if (playAgainBtn) {
        playAgainBtn.addEventListener('click', () => {
            showQuizSection(quizIntro); // Go back to intro to restart
            score = 0;
            questionsAnsweredThisSession = 0;
            questionsLog = [];
            currentQuizSongs = []; // Reset songs used in this session
        });
    }

    if (endQuizBtn) {
        endQuizBtn.addEventListener('click', endQuizSession);
    }
    
    if (backToMainFromResultsBtn) {
        backToMainFromResultsBtn.addEventListener('click', () => {
            window.location.href = 'main.html';
        });
    }

    if (startQuizBtn) { // Listener for a central start quiz button (if it exists)
        startQuizBtn.addEventListener('click', () => {
            startQuiz('normal'); // Default quiz mode
        });
    }


    /**
     * Inicializa o Firebase e autentica o usuário (anónimo ou com token).
     * Após a autenticação, carrega as músicas.
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
                   apiKey: "[]",
                   authDomain: "[]",
                   projectId: "[]",
                   storageBucket: "[]",
                   messagingSenderId: "[]",
                   appId: "[]",
                   measurementId: "[]"
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

            // Listener para o estado de autenticação: garante que as músicas só são carregadas após o utilizador estar autenticado
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
                        // NOVO: Assegura que o documento do usuário tem pelo menos um campo para ser visível pelo backend
                        const userDocRef = doc(db, `artifacts/${appId}/users/${userId}`);
                        await setDoc(userDocRef, { 
                            lastAccessed: serverTimestamp(), // Corrigido
                            userId: userId // Adiciona o userId como um campo direto também
                        }, { merge: true }); // Usar merge:true para não sobrescrever outros campos se existirem
                        console.log(`[FIREBASE_AUTH] 'lastAccessed' field set for user document: ${userId}`);
                    } catch (error) {
                        console.error("[FIREBASE_AUTH_ERROR] Erro durante a autenticação anónima/token personalizado:", error);
                        showMessageBox("Erro de autenticação no Firebase. Algumas funcionalidades podem não funcionar. Verifique sua conexão de rede e console.");
                        userId = crypto.randomUUID(); // Fallback para um UUID aleatório se a autenticação falhar
                        console.warn(`[FIREBASE_AUTH_FALLBACK] Usando UUID aleatório como userId: ${userId}`);
                    }
                }
                // Uma vez autenticado (ou userId de fallback definido), carrega as músicas
                console.log("[FIREBASE_AUTH] Estado de autenticação alterado. Carregando músicas agora.");
                await loadSongs(); // Carrega as músicas somente após a autenticação estar pronta
            });

        } catch (error) {
            console.error("[FIREBASE_INIT_ERROR] Erro global durante a inicialização do Firebase:", error);
            showMessageBox("Erro crítico ao inicializar o Firebase. Algumas funcionalidades podem não funcionar. Verifique o console.");
            showQuizSection(quizIntro);
        }
    }

    // Chama a função de inicialização do Firebase quando o DOM estiver carregado
    console.log("[INIT] DOMContentLoaded finished. Calling initializeFirebaseAndAuth.");
    initializeFirebaseAndAuth();
});
