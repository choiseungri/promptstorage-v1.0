// options.js

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
    let expandedItems = new Set(); // 펼쳐진 항목들 추적

    // 초기 로드
    loadMappings();

    // 폼 제출 처리
    addForm.addEventListener('submit', function(e) {
        e.preventDefault();
        handleAddOrUpdate();
    });

    // 취소 버튼
    cancelButton.addEventListener('click', clearForm);

    // 검색 기능
    searchInput.addEventListener('input', handleSearch);

    // 키보드 단축키
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

    // 매핑 데이터 로드
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

    // 문구 미리보기 생성 (첫 50자 + ...)
    function createPreview(text) {
        if (text.length <= 50) return text;
        return text.substring(0, 50) + '...';
    }

    // 매핑 목록 렌더링 (토글 기능 추가)
    function renderMappings(filteredMappings = null) {
        const mappingsToShow = filteredMappings || allMappings;
        const keys = Object.keys(mappingsToShow).filter(key => typeof mappingsToShow[key] === 'string');

        if (keys.length === 0) {
            mappingsListDiv.innerHTML = `
                <div class="empty-state">
                    <h3>등록된 단축키가 없습니다</h3>
                    <p>위에서 새로운 키워드와 문구를 추가해보세요!</p>
                </div>
            `;
            return;
        }

        mappingsListDiv.innerHTML = keys.sort().map(keyword => {
            const phrase = mappingsToShow[keyword];
            const isExpanded = expandedItems.has(keyword);
            const preview = createPreview(phrase);
            const needsToggle = phrase.length > 50;

            return `
                <div class="mapping-item" data-keyword="${escapeHtml(keyword)}">
                    <div class="text-content">
                        <div class="keyword-header" ${needsToggle ? 'data-toggle="true"' : ''}>
                            <div class="keyword">/${escapeHtml(keyword)}</div>
                            ${needsToggle ? `
                                <button class="toggle-btn ${isExpanded ? '' : 'collapsed'}" 
                                        data-action="toggle" 
                                        data-keyword="${escapeHtml(keyword)}"
                                        title="${isExpanded ? '접기' : '펼치기'}">
                                    ▼
                                </button>
                            ` : ''}
                        </div>
                        
                        ${needsToggle && !isExpanded ? `
                            <div class="phrase-preview">${escapeHtml(preview)}</div>
                        ` : ''}
                        
                        <div class="phrase-container ${needsToggle ? (isExpanded ? 'expanded' : 'collapsed') : 'expanded'}">
                            <div class="phrase">${escapeHtml(phrase)}</div>
                        </div>
                    </div>
                    <div class="actions">
                        <button class="btn btn-edit" data-action="edit" data-keyword="${escapeHtml(keyword)}">수정</button>
                        <button class="btn btn-danger" data-action="delete" data-keyword="${escapeHtml(keyword)}">삭제</button>
                    </div>
                </div>
            `;
        }).join('');

        // 동적으로 생성된 버튼들에 이벤트 리스너 추가
        addActionEventListeners();
    }

    // 동적 버튼들에 이벤트 리스너 추가 (토글 기능 포함)
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

        // 토글 버튼 클릭 이벤트
        toggleButtons.forEach(button => {
            button.addEventListener('click', function(e) {
                e.stopPropagation();
                const keyword = this.getAttribute('data-keyword');
                togglePhrase(keyword);
            });
        });

        // 키워드 헤더 클릭으로도 토글 가능
        toggleHeaders.forEach(header => {
            header.addEventListener('click', function(e) {
                // 버튼 클릭은 제외
                if (e.target.classList.contains('toggle-btn')) return;
                
                const keyword = this.querySelector('.toggle-btn').getAttribute('data-keyword');
                togglePhrase(keyword);
            });
        });
    }

    // 문구 토글 함수
    function togglePhrase(keyword) {
        const isExpanded = expandedItems.has(keyword);
        
        if (isExpanded) {
            expandedItems.delete(keyword);
        } else {
            expandedItems.add(keyword);
        }
        
        // 해당 항목만 업데이트
        updateSingleItem(keyword);
    }

    // 단일 항목 업데이트 (성능 최적화)
    function updateSingleItem(keyword) {
        const item = mappingsListDiv.querySelector(`[data-keyword="${keyword}"]`);
        if (!item) return;

        const phrase = allMappings[keyword];
        const isExpanded = expandedItems.has(keyword);
        const preview = createPreview(phrase);
        const needsToggle = phrase.length > 50;

        if (!needsToggle) return;

        const toggleBtn = item.querySelector('.toggle-btn');
        const phraseContainer = item.querySelector('.phrase-container');
        const phrasePreview = item.querySelector('.phrase-preview');

        // 토글 버튼 상태 업데이트
        if (toggleBtn) {
            toggleBtn.classList.toggle('collapsed', !isExpanded);
            toggleBtn.title = isExpanded ? '접기' : '펼치기';
        }

        // 컨테이너 상태 업데이트
        if (phraseContainer) {
            phraseContainer.classList.toggle('expanded', isExpanded);
            phraseContainer.classList.toggle('collapsed', !isExpanded);
        }

        // 미리보기 표시/숨김
        if (phrasePreview) {
            phrasePreview.style.display = isExpanded ? 'none' : 'block';
        } else if (!isExpanded) {
            // 미리보기가 없으면 생성
            const previewElement = document.createElement('div');
            previewElement.className = 'phrase-preview';
            previewElement.textContent = preview;
            item.querySelector('.keyword-header').after(previewElement);
        }
    }

    // 검색 처리
    function handleSearch() {
        const searchTerm = searchInput.value.toLowerCase().trim();
        
        if (!searchTerm) {
            renderMappings();
            return;
        }

        const filteredMappings = {};
        Object.keys(allMappings).forEach(keyword => {
            if (typeof allMappings[keyword] === 'string' && (
                keyword.toLowerCase().includes(searchTerm) || 
                allMappings[keyword].toLowerCase().includes(searchTerm)
            )) {
                filteredMappings[keyword] = allMappings[keyword];
            }
        });

        renderMappings(filteredMappings);
    }

    // 추가 또는 업데이트 처리
    async function handleAddOrUpdate() {
        const keyword = keywordInput.value.trim();
        const phrase = phraseInput.value.trim();

        // 유효성 검사
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
            if (!confirm(`'${keyword}' 키워드가 이미 존재합니다. 덮어쓰시겠습니까?`)) {
                return;
            }
        }

        try {
            // 기존 키워드를 수정하는 경우 기존 키워드 삭제
            if (editingKeyword && editingKeyword !== keyword) {
                await chrome.storage.local.remove(editingKeyword);
                delete allMappings[editingKeyword];
                expandedItems.delete(editingKeyword); // 확장 상태도 제거
            }

            // 새 데이터 저장
            await chrome.storage.local.set({ [keyword]: phrase });
            allMappings[keyword] = phrase;

            // 긴 문구인 경우 자동으로 펼쳐서 보여주기
            if (phrase.length > 50) {
                expandedItems.add(keyword);
            }

            // UI 업데이트
            renderMappings();
            clearForm();
            
            const action = editingKeyword ? '수정' : '추가';
            showNotification(`키워드 '${keyword}'가 성공적으로 ${action}되었습니다.`, 'success');
            
        } catch (error) {
            showNotification('저장 중 오류가 발생했습니다.', 'error');
            console.error('저장 오류:', error);
        }
    }

    // 수정 모드로 전환
    function editMapping(keyword) {
        editingKeyword = keyword;
        keywordInput.value = keyword;
        phraseInput.value = allMappings[keyword] || '';
        addButton.textContent = '수정';
        cancelButton.style.display = 'inline-block';
        keywordInput.focus();
        
        // 해당 항목으로 스크롤
        const item = document.querySelector(`[data-keyword="${keyword}"]`);
        if (item) {
            item.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    // 삭제 처리
    async function deleteMapping(keyword) {
        if (!confirm(`'${keyword}' 키워드를 정말 삭제하시겠습니까?`)) {
            return;
        }

        try {
            await chrome.storage.local.remove(keyword);
            delete allMappings[keyword];
            expandedItems.delete(keyword); // 확장 상태도 제거
            renderMappings();
            showNotification(`키워드 '${keyword}'가 삭제되었습니다.`, 'success');
            
            // 수정 중이던 항목이 삭제된 경우 폼 초기화
            if (editingKeyword === keyword) {
                clearForm();
            }
        } catch (error) {
            showNotification('삭제 중 오류가 발생했습니다.', 'error');
            console.error('삭제 오류:', error);
        }
    }

    // 폼 초기화
    function clearForm() {
        keywordInput.value = '';
        phraseInput.value = '';
        addButton.textContent = '추가';
        cancelButton.style.display = 'none';
        editingKeyword = null;
        keywordInput.focus();
    }

    // 알림 표시
    function showNotification(message, type = 'success') {
        notification.textContent = message;
        notification.className = `notification ${type}`;
        
        setTimeout(() => {
            notification.classList.add('hidden');
        }, 3000);
    }

    // HTML 이스케이프
    function escapeHtml(text) {
        if (typeof text !== 'string') return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
});