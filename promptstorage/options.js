// options.js

// HTML 이스케이프 함수를 스크립트 상단으로 이동
function escapeHtml(text) {
    if (typeof text !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 검색어 하이라이팅 함수
function getHighlightedText(text, term) {
    if (!term) return escapeHtml(text);
    const escapedText = escapeHtml(text);
    // Regex 특수 문자를 term에서 이스케이프
    const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
        const regex = new RegExp(`(${escapedTerm})`, 'gi');
        return escapedText.replace(regex, '<span class="highlight">$1</span>');
    } catch (e) {
        // 잘못된 정규식의 경우 원본 텍스트 반환
        console.error("Highlighting regex error:", e);
        return escapedText;
    }
}

document.addEventListener('DOMContentLoaded', function() {
    const keywordInput = document.getElementById('keywordInput');
    const phraseInput = document.getElementById('phraseInput');
    const addButton = document.getElementById('addButton');
    const cancelButton = document.getElementById('cancelButton');
    const addForm = document.getElementById('addForm');
    const mappingsListDiv = document.getElementById('mappingsList');
    const searchInput = document.getElementById('searchInput');
    const notification = document.getElementById('notification');

    let allMappings = {};
    let editingKeyword = null;
    let expandedItems = new Set();

    loadMappings();

    addForm.addEventListener('submit', function(e) {
        e.preventDefault();
        handleAddOrUpdate();
    });

    cancelButton.addEventListener('click', clearForm);
    searchInput.addEventListener('input', handleSearch);

    keywordInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            phraseInput.focus();
        }
    });

    phraseInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter' && e.ctrlKey) {
            e.preventDefault();
            handleAddOrUpdate();
        }
    });

    async function loadMappings() {
        try {
            const data = await chrome.storage.local.get(null);
            allMappings = data;
            renderMappings();
        } catch (error) {
            showNotification('데이터 로드 중 오류가 발생했습니다.', 'error');
            console.error('로드 오류:', error);
        }
    }

    function createPreview(text) {
        const currentSearchTerm = searchInput.value.trim().toLowerCase();
        let previewText = text;
        if (text.length > 50) {
            previewText = text.substring(0, 50) + '...';
        }
        // 검색어가 있으면 미리보기에도 하이라이팅 적용
        return currentSearchTerm ? getHighlightedText(previewText, currentSearchTerm) : escapeHtml(previewText);
    }

    function renderMappings(filteredMappings = null) {
        const mappingsToShow = filteredMappings || allMappings;
        const keys = Object.keys(mappingsToShow).filter(key => typeof mappingsToShow[key] === 'string');
        const currentSearchTerm = searchInput.value.trim().toLowerCase();

        if (keys.length === 0) {
            mappingsListDiv.innerHTML = `
                <div class="empty-state">
                    <h3>등록된 단축키가 없습니다</h3>
                    <p>위에서 새로운 키워드와 문구를 추가해보세요!</p>
                </div>
            `;
            return;
        }
        
        // Chevron SVG icon
        const chevronSvg = `<svg class="chevron-icon" viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" focusable="false"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"></path></svg>`;

        mappingsListDiv.innerHTML = keys.sort().map(keyword => {
            const phrase = mappingsToShow[keyword];
            const isExpanded = expandedItems.has(keyword);
            
            // 하이라이팅 적용
            const displayKeyword = currentSearchTerm ? getHighlightedText(keyword, currentSearchTerm) : escapeHtml(keyword);
            const displayPhrase = currentSearchTerm ? getHighlightedText(phrase, currentSearchTerm) : escapeHtml(phrase);
            const displayPreview = createPreview(phrase); // createPreview 내부에서 하이라이팅 처리

            const needsToggle = phrase.length > 50;

            return `
                <div class="mapping-item" data-keyword="${escapeHtml(keyword)}">
                    <div class="text-content">
                        <div class="keyword-header" ${needsToggle ? 'data-toggle="true"' : ''}>
                            <div class="keyword">/${displayKeyword}</div>
                            ${needsToggle ? `
                                <button class="toggle-btn ${isExpanded ? '' : 'collapsed'}" 
                                        data-action="toggle" 
                                        data-keyword="${escapeHtml(keyword)}"
                                        title="${isExpanded ? '접기' : '펼치기'}">
                                    ${chevronSvg}
                                </button>
                            ` : ''}
                        </div>
                        
                        ${needsToggle && !isExpanded ? `
                            <div class="phrase-preview">${displayPreview}</div>
                        ` : ''}
                        
                        <div class="phrase-container ${needsToggle ? (isExpanded ? 'expanded' : 'collapsed') : 'expanded'}">
                            <div class="phrase">${displayPhrase}</div>
                        </div>
                    </div>
                    <div class="actions">
                        <button class="btn btn-edit" data-action="edit" data-keyword="${escapeHtml(keyword)}">수정</button>
                        <button class="btn btn-danger" data-action="delete" data-keyword="${escapeHtml(keyword)}">삭제</button>
                    </div>
                </div>
            `;
        }).join('');

        addActionEventListeners();
    }

    function addActionEventListeners() {
        const editButtons = mappingsListDiv.querySelectorAll('[data-action="edit"]');
        const deleteButtons = mappingsListDiv.querySelectorAll('[data-action="delete"]');
        const toggleButtons = mappingsListDiv.querySelectorAll('[data-action="toggle"]');
        const toggleHeaders = mappingsListDiv.querySelectorAll('[data-toggle="true"]');

        editButtons.forEach(button => {
            button.addEventListener('click', function(e) {
                e.stopPropagation();
                const keyword = this.getAttribute('data-keyword');
                editMapping(keyword);
            });
        });

        deleteButtons.forEach(button => {
            button.addEventListener('click', function(e) {
                e.stopPropagation();
                const keyword = this.getAttribute('data-keyword');
                deleteMapping(keyword);
            });
        });

        toggleButtons.forEach(button => {
            button.addEventListener('click', function(e) {
                e.stopPropagation();
                const keyword = this.getAttribute('data-keyword');
                togglePhrase(keyword);
            });
        });

        toggleHeaders.forEach(header => {
            header.addEventListener('click', function(e) {
                if (e.target.closest('.toggle-btn')) return; // Use closest to handle clicks on SVG
                const keyword = this.querySelector('.toggle-btn').getAttribute('data-keyword');
                togglePhrase(keyword);
            });
        });
    }

    function togglePhrase(keyword) {
        if (expandedItems.has(keyword)) {
            expandedItems.delete(keyword);
        } else {
            expandedItems.add(keyword);
        }
        updateSingleItem(keyword);
    }

    function updateSingleItem(keyword) {
        const escapedKeyword = CSS.escape(keyword);
        const item = mappingsListDiv.querySelector(`[data-keyword="${escapedKeyword}"]`);
        if (!item) return;

        const phrase = allMappings[keyword];
        const isExpanded = expandedItems.has(keyword);
        // createPreview handles highlighting internally based on searchInput
        const displayPreview = createPreview(phrase); 
        const needsToggle = phrase.length > 50;

        if (!needsToggle) return;

        const toggleBtn = item.querySelector('.toggle-btn');
        const phraseContainer = item.querySelector('.phrase-container');
        let phrasePreview = item.querySelector('.phrase-preview'); // Use let as it might be created

        if (toggleBtn) {
            toggleBtn.classList.toggle('collapsed', !isExpanded);
            toggleBtn.title = isExpanded ? '접기' : '펼치기';
        }

        if (phraseContainer) {
            phraseContainer.classList.toggle('expanded', isExpanded);
            phraseContainer.classList.toggle('collapsed', !isExpanded);
        }
        
        // 미리보기 표시/숨김 및 내용 업데이트
        if (isExpanded) {
            if (phrasePreview) {
                phrasePreview.style.display = 'none';
            }
        } else { // 축소된 상태
            if (phrasePreview) {
                phrasePreview.innerHTML = displayPreview; // Update content with potential highlighting
                phrasePreview.style.display = 'block';
            } else {
                // 미리보기가 없으면 생성
                const previewElement = document.createElement('div');
                previewElement.className = 'phrase-preview';
                previewElement.innerHTML = displayPreview; // Use innerHTML due to potential highlighting
                // Insert after keyword-header
                const keywordHeader = item.querySelector('.keyword-header');
                if (keywordHeader && keywordHeader.parentNode) {
                     keywordHeader.parentNode.insertBefore(previewElement, keywordHeader.nextSibling);
                }
            }
        }
    }

    function handleSearch() {
        const searchTerm = searchInput.value.toLowerCase().trim();
        
        if (!searchTerm) {
            renderMappings(); // Re-render without filter, highlighting will be handled by renderMappings
            return;
        }

        const filteredMappings = {};
        Object.keys(allMappings).forEach(key => {
            if (typeof allMappings[key] === 'string' && (
                key.toLowerCase().includes(searchTerm) || 
                allMappings[key].toLowerCase().includes(searchTerm)
            )) {
                filteredMappings[key] = allMappings[key];
            }
        });
        // renderMappings will apply highlighting based on currentSearchTerm
        renderMappings(filteredMappings);
    }

    async function handleAddOrUpdate() {
        const keyword = keywordInput.value.trim();
        const phrase = phraseInput.value.trim();

        if (!keyword) {
            showNotification('키워드를 입력해주세요.', 'error');
            keywordInput.focus();
            return;
        }
        if (!phrase) {
            showNotification('문구를 입력해주세요.', 'error');
            phraseInput.focus();
            return;
        }
        if (keyword.includes('/') || keyword.includes(' ')) {
            showNotification('키워드에는 슬래시(/)나 공백을 사용할 수 없습니다.', 'error');
            keywordInput.focus();
            return;
        }

        if (!editingKeyword && allMappings[keyword]) {
            if (!confirm(`'${escapeHtml(keyword)}' 키워드가 이미 존재합니다. 덮어쓰시겠습니까?`)) {
                return;
            }
        }

        try {
            if (editingKeyword && editingKeyword !== keyword) {
                await chrome.storage.local.remove(editingKeyword);
                delete allMappings[editingKeyword];
                expandedItems.delete(editingKeyword);
            }

            await chrome.storage.local.set({ [keyword]: phrase });
            allMappings[keyword] = phrase;

            if (phrase.length > 50 && !editingKeyword) { // Only auto-expand for new long phrases
                expandedItems.add(keyword);
            } else if (editingKeyword && phrase.length <= 50) { // Collapse if edited to be short
                expandedItems.delete(keyword);
            }

            renderMappings(); // Re-render to reflect changes and potential highlighting
            clearForm();
            
            const action = editingKeyword ? '수정' : '추가';
            showNotification(`키워드 '${escapeHtml(keyword)}'가 성공적으로 ${action}되었습니다.`, 'success');
            
        } catch (error) {
            showNotification('저장 중 오류가 발생했습니다.', 'error');
            console.error('저장 오류:', error);
        }
    }

    function editMapping(keywordToEdit) {
        editingKeyword = keywordToEdit; // Use a different variable name to avoid confusion
        keywordInput.value = keywordToEdit;
        phraseInput.value = allMappings[keywordToEdit] || '';
        addButton.textContent = '수정';
        cancelButton.style.display = 'inline-block';
        keywordInput.focus();
        
        const escapedKeyword = CSS.escape(keywordToEdit);
        const item = document.querySelector(`[data-keyword="${escapedKeyword}"]`);
        if (item) {
            item.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    async function deleteMapping(keywordToDelete) {
        if (!confirm(`'${escapeHtml(keywordToDelete)}' 키워드를 정말 삭제하시겠습니까?`)) {
            return;
        }

        try {
            await chrome.storage.local.remove(keywordToDelete);
            delete allMappings[keywordToDelete];
            expandedItems.delete(keywordToDelete);
            
            if (editingKeyword === keywordToDelete) {
                clearForm(); // Clear form if the item being edited is deleted
            }
            renderMappings(); // Re-render
            showNotification(`키워드 '${escapeHtml(keywordToDelete)}'가 삭제되었습니다.`, 'success');
        } catch (error) {
            showNotification('삭제 중 오류가 발생했습니다.', 'error');
            console.error('삭제 오류:', error);
        }
    }

    function clearForm() {
        keywordInput.value = '';
        phraseInput.value = '';
        addButton.textContent = '추가';
        cancelButton.style.display = 'none';
        editingKeyword = null;
        keywordInput.focus();
    }

    function showNotification(message, type = 'success') {
        notification.innerHTML = message; // Use innerHTML if message might contain escaped HTML (e.g. from keyword)
        notification.className = `notification ${type}`;
        
        setTimeout(() => {
            notification.classList.add('hidden');
        }, 3000);
    }
});
