document.addEventListener('DOMContentLoaded', () => {
  const tagButton = document.getElementById('tag-button');
  const tagModal = document.getElementById('tag-modal');
  const closeButton = document.querySelector('.close-button');
  const tagInput = document.getElementById('tag-input');
  const selectedTagsDisplay = document.getElementById('selected-tags-display');
  const availableTagsList = document.getElementById('available-tags-list');
  const searchInput = document.getElementById('search-input');

  let allAvailableTags = []; // Array de objetos {id, value}
  let selectedTags = new Set(); // Usar um Set para garantir tags únicas (apenas os valores das tags)

  // Função para carregar as tags do counter.json
  async function loadTags() {
    try {
      const response = await fetch('counter.json'); // Already set to counter.json, good!
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json(); 
      
      // If counter.json is a Python Counter dict (e.g., {"item1": 5, "item2": 3})
      // we want to extract the keys as tags.
      if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
          let idCounter = 1; // Used to assign unique IDs to each tag object
          allAvailableTags = Object.keys(data).map(key => ({ 
              id: idCounter++, // Assign a unique ID
              value: key      // Use the key (item name) as the tag value
          }));
      } else if (Array.isArray(data)) {
          // Fallback for an array of objects {id, value} if counter.json somehow contains it
          allAvailableTags = data; 
      } else {
          console.warn("Unexpected data format in counter.json. Expected an object or array.", data);
          allAvailableTags = []; // Initialize as empty to prevent errors
      }
      
      renderAvailableTags(); // Renderiza as tags disponíveis ao carregar o modal pela primeira vez
    } catch (error) {
      console.error('Erro ao carregar tags:', error);
    }
  }

  // Função para renderizar as tags disponíveis na lista clicável
  function renderAvailableTags(filter = '') {
    availableTagsList.innerHTML = '';
    const filteredTags = allAvailableTags.filter(tagObj =>
      tagObj.value.toLowerCase().includes(filter.toLowerCase()) && !selectedTags.has(tagObj.value)
    );

    filteredTags.forEach(tagObj => {
      const tagItem = document.createElement('span');
      tagItem.classList.add('available-tag-item');
      tagItem.textContent = tagObj.value;
      tagItem.addEventListener('click', () => addTag(tagObj.value));
      availableTagsList.appendChild(tagItem);
    });
  }

  // Função para renderizar as tags selecionadas
  function renderSelectedTags() {
    selectedTagsDisplay.innerHTML = '';
    selectedTags.forEach(tagValue => {
      const tagItem = document.createElement('span');
      tagItem.classList.add('selected-tag-item');
      tagItem.textContent = tagValue;

      const removeButton = document.createElement('span');
      removeButton.classList.add('remove-tag');
      removeButton.textContent = 'x';
      removeButton.addEventListener('click', () => removeTag(tagValue));

      tagItem.appendChild(removeButton);
      selectedTagsDisplay.appendChild(tagItem);
    });
    updateSearchInput(); // Atualiza o campo de pesquisa principal sempre que as tags selecionadas mudam
  }

  // Função para adicionar uma tag
  function addTag(tagValue) {
    if (tagValue && !selectedTags.has(tagValue)) {
      selectedTags.add(tagValue);
      renderSelectedTags();
      renderAvailableTags(tagInput.value); // Re-render available tags to remove the added one
      tagInput.value = ''; // Clear input after adding
      tagInput.focus(); // Keep focus on input
    }
  }

  // Função para remover uma tag
  function removeTag(tagValue) {
    selectedTags.delete(tagValue);
    renderSelectedTags();
    renderAvailableTags(tagInput.value); // Re-render available tags to show the removed one again
  }

  // Função para atualizar o campo de pesquisa principal com as tags
  function updateSearchInput() {
    console.log("updateSearchInput called.");
    console.log("searchInput.value before processing:", searchInput.value);
    const tagsArray = Array.from(selectedTags);
    
    // Remove APENAS as tags do modal que já estão no input
    let currentInputText = searchInput.value;
    tagsArray.forEach(tagValue => {
        const tagWithHashAndUnderscore = `#${tagValue.replace(/\s/g, '_')}`;
        // Regex para remover a tag exata do input, com ou sem espaços ao redor
        currentInputText = currentInputText.replace(new RegExp(`\\s*${tagWithHashAndUnderscore}\\b`, 'g'), '').trim();
    });

    // Adiciona as tags do modal (agora sem duplicatas ou conflitos com digitadas)
    const tagsForDisplay = tagsArray.map(tag => `#${tag.replace(/\s/g, '_')}`).join(' ');
    
    let finalSearchValue = currentInputText.trim();
    if (tagsForDisplay) {
        finalSearchValue += (finalSearchValue ? ' ' : '') + tagsForDisplay;
    }

    searchInput.value = finalSearchValue.trim();
    console.log("searchInput.value after update:", searchInput.value);
  }

  // Event Listeners
  // Event listener para abrir o modal de tags
  if (tagButton) {
    tagButton.addEventListener('click', () => {
      tagModal.style.display = 'block'; // Mostra o modal
      renderAvailableTags(); // Renderiza as tags disponíveis ao abrir o modal
      tagInput.focus(); // Coloca o foco no campo de input do modal
    });
  } else {
    console.error("Element with ID 'tag-button' not found. Cannot attach click listener.");
  }

  const imFeelingLuckyBtn = document.getElementById('im-feeling-lucky-btn');

  // NOVO: Event listener para o botão "I'm Feeling Lucky" para pré-processar e enviar parâmetros separados
  imFeelingLuckyBtn.addEventListener('click', () => {
    console.log("I'm Feeling Lucky button clicked!");
    const rawQuery = searchInput.value.trim();
    console.log("Raw Query from input:", rawQuery);

    let year = null;
    let freeText = [];
    let parsedTags = new Set(); // Para coletar tags da query digitada

    // 1. Extrair Ano
    const yearMatch = rawQuery.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) {
      year = yearMatch[0];
      console.log("Extracted Year:", year);
    }

    // 2. Extrair Tags Digitadas
    const tagMatches = rawQuery.matchAll(/#([a-zA-Z0-9_]+)/g);
    for (const match of tagMatches) {
        parsedTags.add(match[1].replace(/_/g, ' ')); // Normaliza: substitui _ por espaço
    }
    console.log("Parsed Tags from raw query:", Array.from(parsedTags));

    // 3. Extrair Texto Livre (que não é ano nem tag)
    let tempFreeText = rawQuery
        .replace(/\b(19|20)\d{2}\b/g, '') // Remove anos
        .replace(/#([a-zA-Z0-9_]+)/g, '') // Remove tags
        .trim();
    freeText = tempFreeText.split(/\s+/).filter(part => part.length > 0);
    console.log("Free Text Parts:", freeText);

    // 4. Combinar tags digitadas com tags selecionadas do modal
    const allCombinedTags = new Set([...selectedTags, ...parsedTags]);
    const tagsParam = Array.from(allCombinedTags).join(',');
    console.log("All Combined Tags for URL:", tagsParam);

    let redirectUrl = 'quiz.html';
    const params = [];
    
    if (year) {
      params.push(`year=${encodeURIComponent(year)}`);
    }
    if (tagsParam) {
      params.push(`tags=${encodeURIComponent(tagsParam)}`);
    }
    if (freeText.length > 0) {
      params.push(`text=${encodeURIComponent(freeText.join(' '))}`);
    }

    console.log("URL Parameters to be sent:", params);

    if (params.length > 0) {
      redirectUrl += `?${params.join('&')}`;
    }
    console.log("Final redirect URL:", redirectUrl);
    window.location.href = redirectUrl;
  });

  // Event listeners para fechar o modal
  closeButton.addEventListener('click', () => {
    tagModal.style.display = 'none';
    tagInput.value = ''; // Limpa o input do modal ao fechar
  });

  window.addEventListener('click', (event) => {
    if (event.target === tagModal) {
      tagModal.style.display = 'none';
      tagInput.value = ''; // Limpa o input do modal ao fechar
    }
  });

  // Listener para o input de tags para filtrar as tags disponíveis
  tagInput.addEventListener('input', () => {
    renderAvailableTags(tagInput.value);
  });

  // Adicionar tag ao pressionar Enter no input de tags
  tagInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
      const customTag = tagInput.value.trim();
      if (customTag) {
        addTag(customTag);
      }
    }
  });


    // --- Fullscreen Utility Function ---
    function requestFullscreen() {
        const element = document.documentElement; // Target the entire HTML document

        if (element.requestFullscreen) {
            element.requestFullscreen().catch(e => {
                console.warn("Fullscreen request blocked or failed:", e);
            });
        } else if (element.mozRequestFullScreen) { // Firefox
            element.mozRequestFullScreen().catch(e => {
                console.warn("Fullscreen request (moz) blocked or failed:", e);
            });
        } else if (element.webkitRequestFullscreen) { // Chrome, Safari & Opera
            element.webkitRequestFullscreen().catch(e => {
                console.warn("Fullscreen request (webkit) blocked or failed:", e);
            });
        } else if (element.msRequestFullscreen) { // IE/Edge
            element.msRequestFullscreen().catch(e => {
                console.warn("Fullscreen request (ms) blocked or failed:", e);
            });
        } else {
            console.log("Your browser does not support the Fullscreen API.");
        }
    }

    // --- Attempting "Invisible Button" Autoplay (likely to be blocked) ---
    const invisibleFullscreenButton = document.getElementById('invisible-fullscreen-button');
    if (invisibleFullscreenButton) {
        // Add event listener to the invisible button
        invisibleFullscreenButton.addEventListener('click', () => {
            console.log("Invisible button clicked! Attempting fullscreen...");
            requestFullscreen();
        });

        // Programmatically "click" the invisible button after DOM is loaded
        // This will likely be blocked by modern browsers for security reasons.
        console.log("Attempting to programmatically click the invisible fullscreen button on load...");
        invisibleFullscreenButton.click();
    }


  // --- Fullscreen triggered by existing VISIBLE buttons (Recommended) ---

  // Get references to your existing buttons
  const googleSearchButton = document.getElementById('google-search-button');
  const imFeelingLuckyButton = document.getElementById('im-feeling-lucky-btn');

  // Add event listeners to trigger fullscreen on click for these buttons
  if (googleSearchButton) {
      googleSearchButton.addEventListener('click', () => {
          console.log("Google Search button clicked. Attempting fullscreen...");
          requestFullscreen();
      });
  }

  if (imFeelingLuckyButton) {
      imFeelingLuckyButton.addEventListener('click', () => {
          console.log("I'm Feeling Lucky button clicked. Attempting fullscreen...");
          requestFullscreen();
      });
  }

  if (tagButton) {
      tagButton.addEventListener('click', () => {
          console.log("Adicionar Tags button clicked. Attempting fullscreen...");
          requestFullscreen();
      });
  }

  // Inicialização
  loadTags();
  // Renderiza as tags selecionadas existentes (se houver, ao carregar a página)
  renderSelectedTags();
});
