document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM Content Loaded: Initializing search.js script.');

    // Constantes para paginação
    const resultsPerPage = 10; // Número de resultados por página

    // Obtém os parâmetros da URL
    const urlParams = new URLSearchParams(window.location.search);
    const query = urlParams.get('q') || ''; // Obtém a consulta 'q' da URL
    const tagsParam = urlParams.get('tags');
    const selectedTags = tagsParam ? tagsParam.split(',') : [];
    let currentPage = parseInt(urlParams.get('page')) || 1; // Obtém a página da URL, padrão para 1

    // Variável para armazenar todos os resultados da pesquisa atual
    let allEnrichedSongs = []; // Armazenará as músicas do songs_enriched_deezer.json
    let currentFilteredSongs = [];

    // Cache para resultados de verificação de caminhos de áudio (verdadeiro/falso para cada path)
    const audioPathCache = new Map();

    // Cache para o histórico de gêneros (chave: nome do gênero normalizado, valor: texto da história)
    const genreHistoryMap = new Map(); // Mapa para histórico de gêneros

    // NOVO: Cache para contagem de popularidade de tags (chave: nome da tag normalizado, valor: contagem)
    const popularityMap = new Map();

    // Encontra e atualiza os campos de entrada de pesquisa e o texto de exibição
    const searchInputTop = document.getElementById('search-query-input');
    const searchInputBottom = document.getElementById('bottom-search-input');
    const displayQueryText = document.getElementById('display-query-text');
    const searchResultsContainer = document.getElementById('search-results-container');
    const noResultsMessage = document.getElementById('no-results-message');
    const resultsCountTime = document.getElementById('results-count-time'); // Elemento para tempo e contagem
    const paginationTbody = document.getElementById('pagination-tbody'); // O tbody da tabela de paginação

    // Referências: Elementos da Sidebar
    const dedicatedMp3PlayerSection = document.getElementById('dedicated-mp3-player-section');
    const currentSongInfo = document.getElementById('current-song-info');
    const dedicatedAudioPlayer = document.getElementById('dedicated-audio-player');
    const dedicatedPlayButton = document.getElementById('dedicated-play-button');

    // Referência direta para o div da história do gênero dentro do player section
    const genreHistoryContent = document.getElementById('genre-history-content');

    let dedicatedPlayTimeout; // Para controlar o timeout de 5 segundos do player dedicado

    // Atualiza os campos de pesquisa no topo e no rodapé
    if (searchInputTop) {
        searchInputTop.value = query;
    }
    if (searchInputBottom) {
        searchInputBottom.value = query;
    }

    // Função para formatar o tempo de exibição (mantida)
    function formatTime(milliseconds) {
        if (milliseconds < 1) {
            return `0.0${Math.floor(milliseconds * 100)} segundos`;
        }
        return `${(milliseconds / 1000).toFixed(2)} segundos`;
    }

    /**
     * Carrega os dados das músicas do arquivo songs_enriched_deezer.json.
     * @returns {Promise<Array>} Uma promessa que resolve com o array de músicas.
     */
    async function loadEnrichedSongsData() {
        console.log('Attempting to load songs_enriched_deezer.json...');
        try {
            const response = await fetch('songs_enriched_deezer.json');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            allEnrichedSongs = await response.json();
            console.log("songs_enriched_deezer.json carregado com sucesso. Total:", allEnrichedSongs.length);
            return allEnrichedSongs;
        } catch (error) {
            console.error('Erro ao carregar songs_enriched_deezer.json. Detalhes:', error);
            return [];
        }
    }

    /**
     * Carrega os dados de história dos gêneros do arquivo genre_history.json.
     * Popula o genreHistoryMap para fácil acesso.
     */
    async function loadGenreHistory() {
        console.log('Attempting to load genre_history.json...');
        try {
            const response = await fetch('genre_history.json');
            if (!response.ok) {
                // Se o arquivo não for encontrado ou houver erro, loga e continua
                console.warn(`[WARN] genre_history.json not found or HTTP error! Status: ${response.status}. Continuing without genre history.`);
                return;
            }
            const data = await response.json();
            if (data && Array.isArray(data.genre_history)) {
                data.genre_history.forEach(entry => {
                    if (entry.genre && entry.history) {
                        genreHistoryMap.set(normalizeString(entry.genre), entry.history);
                    }
                });
                console.log(`[SUCCESS] genre_history.json loaded and mapped. Total genre histories: ${genreHistoryMap.size}`);
            } else {
                console.warn('[WARN] genre_history.json loaded but format is not as expected (expected { "genre_history": [...] }) or is empty. Continuing without genre history.');
            }
        } catch (error) {
            console.error('[ERROR] Erro ao carregar genre_history.json. Detalhes:', error);
        }
    }

    /**
     * Carrega os dados de contagem de popularidade do arquivo counter.json.
     * Popula o popularityMap para fácil acesso.
     */
    async function loadPopularityData() {
        console.log('[search.js] Attempting to load counter.json for popularity data...');
        try {
            const response = await fetch('counter.json');
            if (!response.ok) {
                console.warn(`[search.js WARN] counter.json not found or HTTP error! Status: ${response.status}. Continuing without popularity data.`);
                return;
            }
            const data = await response.json();
            if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
                Object.entries(data).forEach(([tag, count]) => {
                    popularityMap.set(normalizeString(tag), count);
                });
                console.log(`[search.js SUCCESS] counter.json loaded and mapped for popularity. Total entries: ${popularityMap.size}`);
            } else {
                console.warn('[search.js WARN] counter.json loaded but format is not as expected (expected an object). Continuing without popularity data.');
            }
        } catch (error) {
            console.error('[search.js ERROR] Erro ao carregar counter.json. Detalhes:', error);
        }
    }

    /**
     * Helper function to normalize strings for comparison.
     * Alinhado com a função normalize_string_py do Python para consistência.
     * Remove acentos, converte para minúsculas e remove caracteres não alfanuméricos.
     * @param {string} str The string to normalize.
     * @returns {string} The normalized string.
     */
    function normalizeString(str) {
        if (!str) return '';
        // Remove acentos
        let normalized = str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

        // Converte para minúsculas e remove espaços, hifens, underscores
        normalized = normalized.toLowerCase()
                               .replace(/ /g, "")
                               .replace(/-/g, "")
                               .replace(/_/g, "");
        // Remove caracteres não alfanuméricos (mantém apenas letras e números a-z0-9)
        normalized = normalized.replace(/[^a-z0-9]/g, '');
        return normalized;
    }

    // Carrega todos os dados necessários na inicialização
    Promise.all([
        loadEnrichedSongsData(),
        loadGenreHistory(),
        loadPopularityData() // Carrega os dados de popularidade em paralelo
    ]).then(() => {
        console.log('All initial data loaded (songs, genre history, and popularity).');
        if (query) {
            console.log('Query found:', query);
            performSearch(query, selectedTags, currentPage);
        } else {
            console.log('No query found. Initializing without search results.');
            performSearch('', [], currentPage);
        }
    }).catch(error => {
        console.error('Error during initial data loading:', error);
    });

    /**
     * Limpa o conteúdo da sidebar e a esconde.
     */
    function clearSidebarContent() {
        currentSongInfo.textContent = '';
        dedicatedAudioPlayer.src = '';
        dedicatedAudioPlayer.load();
        dedicatedPlayButton.textContent = '▶️ Tocar Snippet (5s)';
        dedicatedPlayButton.classList.remove('playing');
        clearTimeout(dedicatedPlayTimeout);

        genreHistoryContent.innerHTML = 'Selecione uma música para ver a história do seu gênero aqui.';
    }

    /**
     * Exibe os detalhes da música selecionada na sidebar, incluindo a história do gênero mais popular.
     * @param {Object} song O objeto da música selecionada.
     */
    function displaySelectedSongDetails(song) {
        // Pausar qualquer áudio que esteja tocando no player dedicado
        if (!dedicatedAudioPlayer.paused) {
            dedicatedAudioPlayer.pause();
            clearTimeout(dedicatedPlayTimeout);
        }

        // --- Atualiza o MP3 Player ---
        if (song.local_preview_path && audioPathCache.get(song.local_preview_path)) {
            dedicatedMp3PlayerSection.style.display = 'block';
            currentSongInfo.textContent = `${song.artist} - ${song.song} (${song.year || 'Ano desconhecido'})`;
            dedicatedAudioPlayer.src = song.local_preview_path;
            dedicatedAudioPlayer.load();
            dedicatedPlayButton.textContent = '▶️ Tocar Snippet (5s)';
            dedicatedPlayButton.classList.remove('playing');
        } else {
            dedicatedMp3PlayerSection.style.display = 'block';
            currentSongInfo.textContent = `${song.artist} - ${song.song} (Prévia de áudio não disponível)`;
            dedicatedAudioPlayer.src = '';
            dedicatedAudioPlayer.load();
            dedicatedPlayButton.textContent = '▶️ Tocar Snippet (5s)';
            dedicatedPlayButton.classList.remove('playing');
            console.warn(`No valid local_preview_path or not verified in cache for "${song.song}" by "${song.artist}" for display.`);
        }

        // --- Atualiza a História do Gênero (dentro do player section) ---
        let genreText = '<span style="color:#70757a;">Nenhuma história detalhada do gênero encontrada para esta música.</span>';

        const allTagsForSong = [
            ...(song.genres || []),
            ...(song.styles || [])
        ].filter(Boolean); // Combina gêneros e estilos e remove valores nulos/vazios

        if (allTagsForSong.length > 0) {
            const tagsWithCounts = allTagsForSong.map(tag => {
                const normalizedTag = normalizeString(tag);
                const count = popularityMap.get(normalizedTag) || 0;
                return { originalTag: tag, normalizedTag: normalizedTag, count: count };
            });

            let selectedTag = null;
            let popTag = null;

            // Encontra a tag mais popular no geral e a tag "Pop" se existir
            tagsWithCounts.forEach(tag => {
                if (tag.normalizedTag === normalizeString('Pop')) {
                    popTag = tag;
                }
                // Inicializa selectedTag com a primeira tag ou a mais popular encontrada
                if (selectedTag === null || tag.count > selectedTag.count) {
                    selectedTag = tag;
                }
            });

            // Lógica para despriorizar "Pop" se houver uma alternativa "próxima"
            const popToleranceFactor = 0.8; // Exemplo: outro gênero deve ser pelo menos 80% tão popular quanto Pop

            if (popTag && selectedTag && selectedTag.normalizedTag === normalizeString('Pop')) {
                let bestAlternativeTag = null;
                tagsWithCounts.forEach(tag => {
                    if (tag.normalizedTag !== normalizeString('Pop')) {
                        // Se a tag não-Pop for "próxima o suficiente" e mais popular que a melhor alternativa atual
                        if (tag.count >= (popTag.count * popToleranceFactor) &&
                            (bestAlternativeTag === null || tag.count > bestAlternativeTag.count)) {
                            bestAlternativeTag = tag;
                        }
                    }
                });

                if (bestAlternativeTag) {
                    selectedTag = bestAlternativeTag; // Prefer the alternative if it meets the criteria
                    console.log(`[DEBUG] Preferiu o gênero não-Pop: ${selectedTag.originalTag} em vez de Pop devido ao fator de tolerância.`);
                }
            }

            const mostPopularTagName = selectedTag ? selectedTag.originalTag : null;
            const normalizedMostPopularTag = selectedTag ? selectedTag.normalizedTag : null;

            if (mostPopularTagName) {
                const history = genreHistoryMap.get(normalizedMostPopularTag);

                if (history) {
                    genreText = `<strong>História do Gênero/Estilo (${mostPopularTagName}):</strong><br>${history}`;
                } else {
                    genreText = `<strong>História do Gênero/Estilo (${mostPopularTagName}):</strong><br><span style="color:#70757a;">História não disponível no momento.</span>`;
                }
            }
        }
        genreHistoryContent.innerHTML = genreText;
    }

    // Event Listeners para o player dedicado (mantidos)
    dedicatedPlayButton.addEventListener('click', () => {
        if (!dedicatedAudioPlayer.src) {
            alert('Por favor, selecione uma música na lista para tocar.');
            return;
        }
        if (dedicatedAudioPlayer.paused) {
            dedicatedAudioPlayer.play().catch(e => {
                console.error('Error playing dedicated audio from button:', e);
                alert('Erro ao tentar tocar o áudio. O navegador pode ter bloqueado a reprodução automática. Por favor, tente novamente.');
            });
            dedicatedPlayButton.textContent = '⏸️ Pausar';
            dedicatedPlayButton.classList.add('playing');

            // Inicia o timeout de 5 segundos
            dedicatedPlayTimeout = setTimeout(() => {
                dedicatedAudioPlayer.pause();
                dedicatedAudioPlayer.currentTime = 0;
                dedicatedPlayButton.textContent = '▶️ Tocar Snippet (5s)';
                dedicatedPlayButton.classList.remove('playing');
            }, 5000);
        } else {
            dedicatedAudioPlayer.pause();
            clearTimeout(dedicatedPlayTimeout); // Limpa o timeout se o usuário pausar manualmente
            dedicatedPlayButton.textContent = '▶️ Tocar Snippet (5s)';
            dedicatedPlayButton.classList.remove('playing');
        }
    });

    dedicatedAudioPlayer.addEventListener('ended', () => {
        dedicatedPlayButton.textContent = '▶️ Tocar Snippet (5s)';
        dedicatedPlayButton.classList.remove('playing');
        clearTimeout(dedicatedPlayTimeout);
    });

    dedicatedAudioPlayer.addEventListener('pause', () => {
        // Se o áudio foi pausado (manual ou pelo timeout), resetar o texto do botão
        if (!dedicatedAudioPlayer.ended) { // Só muda se não for o fim natural da música
            dedicatedPlayButton.textContent = '▶️ Tocar Snippet (5s)';
            dedicatedPlayButton.classList.remove('playing');
            clearTimeout(dedicatedPlayTimeout);
        }
    });

    /**
     * Verifica a acessibilidade de um caminho de áudio usando um HEAD request.
     * Retorna o caminho relativo validado ou null se não for válido.
     * Adiciona o resultado ao cache.
     * @param {string} relativePath O caminho relativo do arquivo de áudio (ex: 'trimmed_previews/Artist - Song.mp3').
     * @returns {Promise<string|null>} O caminho relativo validado ou null.
     */
    async function verifyAudioPath(relativePath) {
        if (audioPathCache.has(relativePath)) {
            // Retorna o caminho válido se já estiver no cache, ou null se já soubermos que é inválido
            return audioPathCache.get(relativePath) ? relativePath : null;
        }

        const testPath = relativePath;
        try {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), 3000); // Timeout de 3 segundos
            const response = await fetch(testPath, { method: 'HEAD', signal: controller.signal });
            clearTimeout(id);

            if (response.ok) {
                audioPathCache.set(relativePath, true); // Guarda no cache que o caminho original é válido
                return relativePath; // Retorna o caminho que de fato funcionou
            }
        } catch (e) {
            // Erro de rede ou timeout
            console.warn(`Verificação de áudio falhou para "${testPath}": ${e.message}`);
        }
        audioPathCache.set(relativePath, false); // Guarda no cache que o caminho original é inválido
        return null; // Nenhum caminho válido encontrado
    }

    /**
     * Realiza a busca de músicas com base na consulta e tags.
     * Filtra e ordena todos os resultados.
     * A verificação de áudio agora é feita antes dos cálculos de paginação.
     * @param {string} query A string de consulta.
     * @param {Array<string>} tags As tags selecionadas para filtrar.
     * @param {number} initialPage A página inicial a ser renderizada após a busca.
     */
    async function performSearch(query, tags, initialPage) {
        console.log('--- PERFORMING SEARCH ---');
        console.log('Query:', query, 'Tags:', tags, 'Initial Page:', initialPage);

        if (allEnrichedSongs.length === 0) {
            console.warn('No songs loaded in allEnrichedSongs. Cannot perform search.');
            noResultsMessage.style.display = 'block';
            if (resultsCountTime) resultsCountTime.textContent = '';
            clearSidebarContent();
            return;
        }

        const startTime = performance.now();
        const songs = allEnrichedSongs;
        console.log('Total songs available for initial filtering:', songs.length);

        const lowerCaseQuery = query.toLowerCase().trim();
        const lowerCaseTags = tags.map(tag => tag.toLowerCase());

        let resultsFilteredByTextAndTags = [];

        // Se a query e as tags estão vazias, mostre todas as músicas ordenadas.
        if (!lowerCaseQuery && lowerCaseTags.length === 0) {
            resultsFilteredByTextAndTags = [...songs]; // Copia todas as músicas
        } else {
            // Lógica de filtragem mais robusta
            // Extrai ano da query
            let searchYear = null;
            const yearMatch = lowerCaseQuery.match(/\b(19|20)\d{2}\b/); // Captura anos 19xx ou 20xx
            if (yearMatch) {
                searchYear = parseInt(yearMatch[0]);
            }

            // Extrai tags da query (ex: #rock, #pop)
            const queryTags = lowerCaseQuery.match(/#(\w+)/g) || [];
            const processedQueryTags = queryTags.map(tag => tag.substring(1)); // Remove '#'

            // Remove o ano e as tags processadas da query para deixar apenas termos livres
            const cleanQuery = lowerCaseQuery
                .replace(/\b(19|20)\d{2}\b/g, '') // Remove anos
                .replace(/#(\w+)/g, '') // Remove tags
                .trim();

            resultsFilteredByTextAndTags = songs.filter(song => {
                let matchesQueryText = false;
                let matchesYear = false;
                let matchesTags = false;

                // 1. Filtragem por Ano
                if (searchYear !== null) {
                    const songYear = parseInt(song.year);
                    // Match exato para o ano
                    if (!isNaN(songYear) && songYear === searchYear) {
                        matchesYear = true;
                    }
                } else {
                    matchesYear = true; // Se não há searchYear, qualquer ano é válido
                }

                // 2. Filtragem por Tags (incluindo as da query e as do seletor)
                const combinedTags = [...lowerCaseTags, ...processedQueryTags];
                if (combinedTags.length === 0) {
                    matchesTags = true; // Se não há tags, considera que corresponde
                } else {
                    matchesTags = (
                        (song.genres && song.genres.some(genre => combinedTags.includes(normalizeString(genre)))) ||
                        (song.styles && song.styles.some(style => combinedTags.includes(normalizeString(style))))
                    );
                }

                // 3. Filtragem por Termos de Texto Livre (artista, música)
                if (cleanQuery) {
                    matchesQueryText = (
                        (song.artist && normalizeString(song.artist).includes(normalizeString(cleanQuery))) ||
                        (song.song && normalizeString(song.song).includes(normalizeString(cleanQuery)))
                    );
                } else {
                    matchesQueryText = true;
                }

                // Combina as condições: todos os critérios presentes devem ser atendidos.
                return matchesYear && matchesTags && matchesQueryText;
            });
        }

        // --- NOVO: Filtrar por disponibilidade de prévia de áudio ANTES da ordenação e paginação ---
        console.log('Starting audio path verification for filtered songs...');
        const songsWithVerifiedPaths = [];
        for (const song of resultsFilteredByTextAndTags) {
            if (song.local_preview_path) {
                const isValidPath = await verifyAudioPath(song.local_preview_path);
                if (isValidPath) {
                    songsWithVerifiedPaths.push(song);
                }
            }
        }
        console.log(`Songs remaining after audio path verification: ${songsWithVerifiedPaths.length}`);

        currentFilteredSongs = songsWithVerifiedPaths; // Atualiza currentFilteredSongs SÓ com caminhos de áudio válidos

        currentFilteredSongs.sort((a, b) => b.weeks_on_board - a.weeks_on_board);

        const totalPagesCalculated = Math.ceil(currentFilteredSongs.length / resultsPerPage);
        let adjustedPage = initialPage;
        if (adjustedPage > totalPagesCalculated && totalPagesCalculated > 0) {
            adjustedPage = totalPagesCalculated;
        } else if (totalPagesCalculated === 0) {
            adjustedPage = 1; // Se não houver resultados, a página é 1 (vazia)
        } else if (adjustedPage < 1) {
            adjustedPage = 1;
        }
        currentPage = adjustedPage;

        const endTimeFilter = performance.now();
        const searchTimeFilter = ((endTimeFilter - startTime) / 1000).toFixed(2);

        console.log('Total results (after all filters including audio preview):', currentFilteredSongs.length);
        console.log('Time for all filtering:', searchTimeFilter, 'seconds.');

        renderResults(searchTimeFilter, currentPage, query, selectedTags);

        // A parte de verificação de áudio em background não é mais necessária aqui, pois já foi feita antecipadamente.
        // Você poderia mantê-la para robustez se antecipar que `local_preview_path` pode mudar ou
        // se a verificação inicial for muito lenta para conjuntos de dados muito grandes e você quiser garantir
        // que as páginas futuras tenham seus caminhos de áudio verificados, mas por enquanto, é redundante.
    }

    /**
     * Renderiza os resultados da pesquisa na página, aplicando a paginação.
     * Esta função agora *não* precisa mais fazer a verificação de áudio, pois já foi feita.
     * @param {string} searchTime O tempo que a pesquisa levou em segundos (do filtro inicial).
     * @param {number} pageToRender A página a ser renderizada.
     * @param {string} currentQuery A consulta de pesquisa atual.
     * @param {Array<string>} currentTags As tags selecionadas atualmente.
     */
    async function renderResults(searchTime, pageToRender, currentQuery, currentTags) {
        console.log('--- RENDERING RESULTS ---');
        console.log('Current Page (from parameter):', pageToRender);
        currentPage = pageToRender; // Atualiza a variável global currentPage

        if (!searchResultsContainer) {
            console.error("Erro em renderResults: searchResultsContainer não encontrado! Verifique o HTML.");
            return;
        }

        // Atualiza o texto da consulta exibido
        if (displayQueryText) {
            displayQueryText.textContent = currentQuery || 'Pesquisar';
        }

        searchResultsContainer.innerHTML = ''; // Limpa os resultados anteriores

        // Calculamos o total de páginas com base na lista COMPLETA filtrada por texto/tags E audio
        const totalResults = currentFilteredSongs.length;
        const totalPages = Math.ceil(totalResults / resultsPerPage);

        console.log('Total Results (for display and pagination):', totalResults, 'Total Pages:', totalPages);

        if (totalResults > 0) {
            noResultsMessage.style.display = 'none'; // Esconde a mensagem de "nenhum resultado"
            if (resultsCountTime) {
                const startIndexDisplay = (currentPage - 1) * resultsPerPage + 1; // Start from 1 for display
                let endIndexDisplay = startIndexDisplay + resultsPerPage - 1;
                if (endIndexDisplay > totalResults) {
                    endIndexDisplay = totalResults;
                }
                resultsCountTime.textContent = `Resultados ${startIndexDisplay} - ${endIndexDisplay} de ${totalResults} resultados. Pesquisa levou ${searchTime !== null ? searchTime : 'N/A'} segundos.`;
            }

            const startIndex = (currentPage - 1) * resultsPerPage;
            const songsToDisplay = currentFilteredSongs.slice(startIndex, startIndex + resultsPerPage);

            console.log('Paginated results (ready for display):', songsToDisplay.length);

            if (songsToDisplay.length > 0) {
                songsToDisplay.forEach((song) => {
                    const resultDiv = document.createElement('div');
                    resultDiv.classList.add('search-result-item');

                    const titleLink = document.createElement('a');
                    titleLink.classList.add('search-result-title');
                    titleLink.href = '#'; // O link será tratado pelo JavaScript para acessibilidade

                    titleLink.textContent = `${song.artist} - ${song.song} (${song.year || 'Ano desconhecido'})`;
                    resultDiv.appendChild(titleLink);

                    // Gêneros e Estilos (permanece como um elemento separado)
                    const genresAndStyles = document.createElement('div');
                    genresAndStyles.classList.add('search-result-genres-styles');
                    const allTags = [...(song.genres || []), ...(song.styles || [])].filter(Boolean); // Combinar e filtrar nulos/vazios
                    genresAndStyles.textContent = `Gênero(s)/Estilo(s): ${allTags.join(', ')}`;
                    resultDiv.appendChild(genresAndStyles);

                    // Adiciona o listener de clique ao título da música
                    // para atualizar o player e a história na sidebar
                    titleLink.addEventListener('click', (event) => {
                        event.preventDefault(); // Impede o comportamento padrão do link
                        displaySelectedSongDetails(song); // Chama a função para atualizar a sidebar
                    });

                    searchResultsContainer.appendChild(resultDiv);
                });
                // Após renderizar os resultados, se houver, exibe os detalhes da primeira música da página
                if (songsToDisplay.length > 0) {
                    displaySelectedSongDetails(songsToDisplay[0]);
                } else {
                    clearSidebarContent();
                }
            } else {
                // This case should ideally not be hit if currentFilteredSongs already only has valid previews
                searchResultsContainer.innerHTML = '<div style="text-align: center; color: #5f6368; margin-top: 20px;">Nenhum resultado com prévia de áudio disponível para esta página.</div>';
                clearSidebarContent();
            }

        } else {
            noResultsMessage.style.display = 'block'; // Exibe a mensagem de "nenhum resultado"
            if (resultsCountTime) {
                resultsCountTime.textContent = ''; // Limpa o tempo e contagem se não houver resultados
            }
            clearSidebarContent(); // Limpa e esconde o conteúdo da sidebar
        }
        // A paginação é sempre renderizada com base em totalResults (do filtro textual/tags e audio)
        // para que o número total de páginas seja consistente.
        renderOriginalStylePagination(totalPages, currentPage, currentQuery, currentTags);
    }

    /**
     * Renderiza os links de paginação no estilo original do Google (com imagens).
     * @param {number} totalPages O número total de páginas.
     * @param {number} currentPage O número da página atual.
     * @param {string} currentQuery A consulta de pesquisa atual.
     * @param {Array<string>} currentTags As tags selecionadas atualmente.
     */
    function renderOriginalStylePagination(totalPages, currentPage, currentQuery, currentTags) {
        console.log('--- RENDERING PAGINATION ---');
        console.log('Total Pages:', totalPages, 'Current Page for Pagination:', currentPage);

        if (!paginationTbody) {
            console.error('Pagination tbody element not found!');
            return;
        }

        paginationTbody.innerHTML = ''; // Limpa o conteúdo existente

        const tr = document.createElement('tr');

        // Result Page: label
        const labelTd = document.createElement('td');
        labelTd.classList.add('pagination-label');
        labelTd.textContent = 'Result\u00A0Page:\u00A0';
        tr.appendChild(labelTd);

        // Lógica para exibir "Só um O" se houver 1 página
        if (totalPages <= 1) {
            if (totalPages === 1) { // Só mostra o "O" se realmente houver 1 página
                const pageTd = document.createElement('td');
                const currentImg = document.createElement('img');
                currentImg.src = 'search_files/nav_current.gif';
                currentImg.alt = '';
                currentImg.border = '0';
                pageTd.appendChild(currentImg);
                pageTd.appendChild(document.createElement('br'));
                const pageSpan = document.createElement('span');
                pageSpan.classList.add('nav-item-current');
                const boldPageNumber = document.createElement('b');
                boldPageNumber.textContent = 1; // Sempre página 1
                pageSpan.appendChild(boldPageNumber);
                pageTd.appendChild(pageSpan);
                tr.appendChild(pageTd);
                paginationTbody.appendChild(tr);
            }
            return; // Sai da função se houver 1 página ou 0
        }

        // First page image (nav_first.gif) - Sempre presente se houver mais de uma página
        const firstPageTd = document.createElement('td');
        const firstPageLink = document.createElement('a');

        const firstPageUrl = `search.html?q=${encodeURIComponent(currentQuery)}${currentTags.length > 0 ? `&tags=${encodeURIComponent(currentTags.join(','))}` : ''}&page=1`;
        firstPageLink.href = firstPageUrl;

        const firstPageImg = document.createElement('img');
        firstPageImg.src = 'search_files/nav_first.gif';
        firstPageImg.alt = '';
        firstPageImg.border = '0';
        firstPageLink.appendChild(firstPageImg);
        firstPageTd.appendChild(firstPageLink);
        tr.appendChild(firstPageTd);

        // Lógica de deslocamento para números de página (janela de 10)
        const maxVisiblePages = 10;
        let startPage = 1;
        let endPage = totalPages;

        if (totalPages > maxVisiblePages) {
            // Tenta centralizar a página atual na janela de 10 páginas
            startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
            endPage = startPage + maxVisiblePages - 1;

            // Se o final da janela for além do total de páginas, ajusta o início para mostrar as últimas 10
            if (endPage > totalPages) {
                endPage = totalPages;
                startPage = totalPages - maxVisiblePages + 1;
                if (startPage < 1) { // Garante que startPage não seja menor que 1
                    startPage = 1;
                }
            }
        }

        for (let i = startPage; i <= endPage; i++) {
            const pageTd = document.createElement('td');
            if (i === currentPage) {
                const currentImg = document.createElement('img');
                currentImg.src = 'search_files/nav_current.gif';
                currentImg.alt = '';
                currentImg.border = '0';
                pageTd.appendChild(currentImg);
                pageTd.appendChild(document.createElement('br'));
                const pageSpan = document.createElement('span');
                pageSpan.classList.add('nav-item-current');
                const boldPageNumber = document.createElement('b'); // Adicionado negrito
                boldPageNumber.textContent = i;
                pageSpan.appendChild(boldPageNumber);
                pageTd.appendChild(pageSpan);
            } else {
                const pageLink = document.createElement('a');
                // Construir a URL para cada página
                const pageUrl = `search.html?q=${encodeURIComponent(currentQuery)}${currentTags.length > 0 ? `&tags=${encodeURIComponent(currentTags.join(','))}` : ''}&page=${i}`;
                pageLink.href = pageUrl;

                const pageImg = document.createElement('img');
                pageImg.src = 'search_files/nav_page.gif';
                pageImg.alt = '';
                pageImg.border = '0';
                pageLink.appendChild(pageImg);
                pageLink.appendChild(document.createElement('br'));
                pageLink.appendChild(document.createTextNode(i));
                pageTd.appendChild(pageLink);
            }
            tr.appendChild(pageTd);
        }

        // Next page link (nav_next.gif) - Sempre presente se totalPages > 1 e não na última página
        // Apenas exibe se a página actual não é a última
        if (currentPage < totalPages) {
            const nextTd = document.createElement('td');
            const nextLink = document.createElement('a');

            const nextPageUrl = `search.html?q=${encodeURIComponent(currentQuery)}${currentTags.length > 0 ? `&tags=${encodeURIComponent(currentTags.join(','))}` : ''}&page=${currentPage + 1}`;
            nextLink.href = nextPageUrl;

            const nextImg = document.createElement('img');
            nextImg.src = 'search_files/nav_next.gif';
            nextImg.alt = '';
            nextImg.border = '0';
            nextLink.appendChild(nextImg);
            nextLink.appendChild(document.createElement('br'));
            const nextSpan = document.createElement('span');
            nextSpan.classList.add('nav-next');
            const nextBold = document.createElement('b');
            nextBold.textContent = 'Next';
            nextSpan.appendChild(nextBold);
            nextLink.appendChild(nextSpan);
            nextTd.appendChild(nextLink);
            tr.appendChild(nextTd);
        }

        paginationTbody.appendChild(tr);
    }
});