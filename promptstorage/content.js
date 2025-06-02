// content.js

console.log("나만의 단축 입력기 content.js 로드됨");

// 대상 입력 필드를 식별하기 위한 CSS 선택자
const targetInputSelectors = 'textarea, input[type="text"], input[type="search"], div[contenteditable="true"]';

let suggestionBox = null; // 제안 UI DOM 요소를 저장할 변수
let currentInputElement = null; // 현재 포커스된 입력 요소를 저장할 변수
let allMappings = {}; // 불러온 모든 키워드-문구 매핑을 저장할 객체
let currentSlashMatch = null; // 현재 감지된 /키워드 정보 저장

// 중복 이벤트 리스너 방지를 위한 WeakSet
const elementsWithListeners = new WeakSet();

// 디바운싱을 위한 타이머
let inputTimeout;

// 저장된 모든 매핑 정보를 불러와 allMappings에 저장하는 함수
async function loadAllMappings() {
    try {
        const items = await chrome.storage.local.get(null);
        allMappings = items;
        console.log("모든 매핑 정보 로드됨:", Object.keys(allMappings).length, "개 항목");
    } catch (error) {
        console.error("매핑 정보 로드 중 오류 발생:", error);
        allMappings = {}; // 오류 발생 시 빈 객체로 초기화
    }
}

// 확장 프로그램 시작 시 매핑 정보 미리 로드
loadAllMappings();

// chrome.storage.onChanged 리스너를 추가하여 옵션 페이지에서 변경사항이 생기면 allMappings 업데이트
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
        console.log("저장소 변경 감지됨, 매핑 정보 업데이트");
        loadAllMappings(); // 변경사항이 있으면 다시 모든 매핑 로드
    }
});

// 입력 필드에 포커스가 갔을 때 이벤트 리스너 추가 (중복 방지 개선)
document.addEventListener('focusin', (event) => {
    if (event.target.matches(targetInputSelectors) && !elementsWithListeners.has(event.target)) {
        currentInputElement = event.target;
        currentInputElement.addEventListener('keydown', handleKeyDown, true);
        currentInputElement.addEventListener('input', handleInput);
        elementsWithListeners.add(event.target);
        console.log('입력 필드에 포커스 및 리스너 추가:', currentInputElement.tagName);
    }
});

// 입력 필드에서 포커스가 벗어났을 때 이벤트 리스너 제거 (중복 방지 개선)
document.addEventListener('focusout', (event) => {
    if (event.target.matches(targetInputSelectors) && elementsWithListeners.has(event.target)) {
        event.target.removeEventListener('keydown', handleKeyDown, true);
        event.target.removeEventListener('input', handleInput);
        elementsWithListeners.delete(event.target);
        
        // 약간의 딜레이 후 제안 UI 숨기기 (제안 항목 클릭 이벤트 처리를 위해)
        setTimeout(() => {
            if (suggestionBox && !suggestionBox.contains(document.activeElement)) {
                hideSuggestionBox();
            }
        }, 150);
    }
});

// 키 입력 처리 함수 (수정됨)
async function handleKeyDown(event) {
    try {
        // 제안 UI가 활성화되어 있을 때의 키 처리 (방향키, Enter, Esc)
        if (suggestionBox && suggestionBox.style.display !== 'none') {
            const items = suggestionBox.querySelectorAll('.suggestion-item');
            let currentIndex = -1;
            
            // 현재 선택된 항목 찾기
            items.forEach((item, index) => {
                if (item.classList.contains('selected')) {
                    currentIndex = index;
                }
            });

            if (event.key === 'ArrowDown') {
                event.preventDefault();
                event.stopPropagation();
                
                // 다음 항목 선택
                if (currentIndex < items.length - 1) {
                    if (currentIndex !== -1) {
                        items[currentIndex].classList.remove('selected');
                        items[currentIndex].style.backgroundColor = 'white';
                    }
                    const nextIndex = currentIndex + 1;
                    items[nextIndex].classList.add('selected');
                    items[nextIndex].style.backgroundColor = '#f0f0f0';
                    items[nextIndex].scrollIntoView({ block: 'nearest' });
                }
                return;
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                event.stopPropagation();
                
                // 이전 항목 선택
                if (currentIndex > 0) {
                    items[currentIndex].classList.remove('selected');
                    items[currentIndex].style.backgroundColor = 'white';
                    const prevIndex = currentIndex - 1;
                    items[prevIndex].classList.add('selected');
                    items[prevIndex].style.backgroundColor = '#f0f0f0';
                    items[prevIndex].scrollIntoView({ block: 'nearest' });
                }
                return;
            } else if (event.key === 'Enter') {
                event.preventDefault();
                event.stopPropagation();
                
                // 선택된 항목이 있으면 클릭 이벤트 발생
                if (currentIndex !== -1 && items[currentIndex]) {
                    const selectedKeyword = items[currentIndex].textContent.substring(1); // '/' 제거
                    selectKeyword(selectedKeyword);
                }
                return;
            } else if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                hideSuggestionBox();
                return;
            }
        }

        // Ctrl + Enter 자동 완성 로직
        if (event.ctrlKey && event.key === 'Enter') {
            // 제안 UI가 열려있으면 선택된 항목 사용
            if (suggestionBox && suggestionBox.style.display !== 'none') {
                const selectedItem = suggestionBox.querySelector('.suggestion-item.selected');
                if (selectedItem) {
                    event.preventDefault();
                    event.stopPropagation();
                    const selectedKeyword = selectedItem.textContent.substring(1); // '/' 제거
                    selectKeyword(selectedKeyword);
                    return;
                }
            }

            // 제안 UI가 없으면 직접 키워드 매칭
            const inputElement = event.target;
            let currentText = '';
            let cursorPos = 0;

            // 안전한 텍스트 및 커서 위치 추출
            if (inputElement.isContentEditable) {
                currentText = inputElement.innerText || inputElement.textContent || '';
                const selection = window.getSelection();
                if (selection.rangeCount > 0) {
                    cursorPos = getCaretPosition(inputElement);
                }
            } else {
                currentText = inputElement.value || '';
                cursorPos = inputElement.selectionStart || 0;
            }

            // 커서 바로 앞의 '/(키워드)' 패턴 감지
            const textBeforeCursor = currentText.substring(0, cursorPos);
            const keywordMatch = textBeforeCursor.match(/\/([^\s/\\]+)$/);

            if (keywordMatch && keywordMatch[1]) {
                const keyword = keywordMatch[1];

                if (allMappings[keyword]) {
                    event.preventDefault();
                    event.stopPropagation();
                    selectKeyword(keyword);
                    console.log(`키워드 '${keyword}' 성공적으로 치환됨`);
                } else {
                    console.log(`키워드 '${keyword}'에 대한 문구를 찾을 수 없습니다.`);
                }
            }
        }
    } catch (error) {
        console.error("handleKeyDown 오류:", error);
    }
}

// 키워드 선택 및 텍스트 교체 함수 (새로 추가)
function selectKeyword(keyword) {
    if (!currentInputElement || !allMappings[keyword] || !currentSlashMatch) {
        console.error('키워드 선택 실패:', { keyword, hasElement: !!currentInputElement, hasMapping: !!allMappings[keyword], hasSlashMatch: !!currentSlashMatch });
        return;
    }

    const phrase = allMappings[keyword];
    const fullSlashCommand = currentSlashMatch.fullMatch;
    const startIndex = currentSlashMatch.startIndex;

    try {
        replaceText(currentInputElement, fullSlashCommand, phrase, startIndex);
        hideSuggestionBox();
        console.log(`키워드 '${keyword}' 성공적으로 치환됨:`, phrase.substring(0, 50) + '...');
    } catch (error) {
        console.error('텍스트 교체 실패:', error);
    }
}

// contentEditable에서 정확한 커서 위치를 구하는 함수
function getCaretPosition(element) {
    let caretOffset = 0;
    const selection = window.getSelection();
    
    if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const preCaretRange = range.cloneRange();
        preCaretRange.selectNodeContents(element);
        preCaretRange.setEnd(range.endContainer, range.endOffset);
        caretOffset = preCaretRange.toString().length;
    }
    
    return caretOffset;
}

// 사용자 입력 감지 함수 (디바운싱 적용)
async function handleInput(event) {
    clearTimeout(inputTimeout);
    inputTimeout = setTimeout(() => {
        performInputHandling(event);
    }, 100); // 100ms 디바운싱
}

// 실제 입력 처리 로직 (수정됨)
async function performInputHandling(event) {
    try {
        if (!currentInputElement) return;

        const inputText = currentInputElement.isContentEditable ? 
            (currentInputElement.innerText || currentInputElement.textContent || '') : 
            (currentInputElement.value || '');
            
        let cursorPos = 0;
        if (currentInputElement.isContentEditable) {
            cursorPos = getCaretPosition(currentInputElement);
        } else {
            cursorPos = currentInputElement.selectionStart || 0;
        }

        const textBeforeCursor = inputText.substring(0, cursorPos);
        const slashMatch = textBeforeCursor.match(/\/([^\s/\\]*)$/);

        if (slashMatch) {
            const partialKeyword = slashMatch[1];
            const fullSlashCommand = slashMatch[0];
            const startIndex = textBeforeCursor.length - fullSlashCommand.length;
            
            // 현재 슬래시 매치 정보 저장
            currentSlashMatch = {
                fullMatch: fullSlashCommand,
                keyword: partialKeyword,
                startIndex: startIndex
            };

            // 개선된 필터링: 부분 문자열 검색 지원
            const filteredKeywords = Object.keys(allMappings).filter(k => 
                k.toLowerCase().includes(partialKeyword.toLowerCase())
            ).sort((a, b) => {
                // 우선순위: 시작하는 것 먼저, 그 다음 포함하는 것
                const aStarts = a.toLowerCase().startsWith(partialKeyword.toLowerCase());
                const bStarts = b.toLowerCase().startsWith(partialKeyword.toLowerCase());
                
                if (aStarts && !bStarts) return -1;
                if (!aStarts && bStarts) return 1;
                return a.localeCompare(b);
            });

            if (filteredKeywords.length > 0) {
                showSuggestionBox(filteredKeywords);
            } else {
                hideSuggestionBox();
            }
        } else {
            hideSuggestionBox();
            currentSlashMatch = null;
        }
    } catch (error) {
        console.error("performInputHandling 오류:", error);
    }
}

// 제안 UI 생성 함수
function createSuggestionBox() {
    if (!suggestionBox) {
        suggestionBox = document.createElement('div');
        suggestionBox.setAttribute('id', 'promptstorage-suggestion-box');
        suggestionBox.style.cssText = `
            position: absolute;
            border: 1px solid #dadce0;
            border-radius: 4px;
            background-color: white;
            z-index: 2147483647;
            max-height: 200px;
            min-width: 150px;
            overflow-y: auto;
            overflow-x: hidden;
            box-shadow: 0 2px 6px rgba(0,0,0,0.1);
            display: none;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        `;
        document.body.appendChild(suggestionBox);

        // 제안창 외부 클릭 시 숨김
        document.addEventListener('click', function(event) {
            if (suggestionBox && suggestionBox.style.display !== 'none' &&
                currentInputElement && !currentInputElement.contains(event.target) &&
                !suggestionBox.contains(event.target)) {
                hideSuggestionBox();
            }
        }, true);
    }
}

// 제안 UI 표시 및 내용 업데이트 함수 (수정됨)
function showSuggestionBox(keywords) {
    if (!currentInputElement) return;
    createSuggestionBox();

    suggestionBox.innerHTML = '';
    keywords.sort();

    keywords.forEach((keyword, index) => {
        const item = document.createElement('div');
        item.classList.add('suggestion-item');
        item.textContent = `/${keyword}`;
        item.style.cssText = `
            padding: 8px 12px;
            cursor: pointer;
            font-size: 14px;
            line-height: 1.4;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            background-color: white;
            transition: background-color 0.1s ease;
        `;

        // 마우스 이벤트
        item.addEventListener('mouseenter', () => {
            // 다른 선택된 항목 해제
            const currentSelected = suggestionBox.querySelector('.suggestion-item.selected');
            if (currentSelected) {
                currentSelected.classList.remove('selected');
                currentSelected.style.backgroundColor = 'white';
            }
            // 현재 항목 선택
            item.classList.add('selected');
            item.style.backgroundColor = '#f0f0f0';
        });

        item.addEventListener('mouseleave', () => {
            // 마우스가 벗어나도 선택 상태는 유지 (키보드 네비게이션을 위해)
        });

        // 클릭 이벤트 (수정됨)
        item.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('클릭된 키워드:', keyword);
            selectKeyword(keyword);
        });
        
        suggestionBox.appendChild(item);
    });

    if (keywords.length > 0) {
        positionSuggestionBox();
        
        // 첫 번째 항목을 기본으로 선택
        const firstItem = suggestionBox.querySelector('.suggestion-item');
        if (firstItem) {
            firstItem.classList.add('selected');
            firstItem.style.backgroundColor = '#f0f0f0';
        }
    } else {
        hideSuggestionBox();
    }
}

// 제안창 위치 계산 함수
function positionSuggestionBox() {
    if (!currentInputElement || !suggestionBox) return;
    
    const rect = currentInputElement.getBoundingClientRect();
    let top = rect.bottom + window.scrollY;
    let left = rect.left + window.scrollX;

    suggestionBox.style.display = 'block';

    // 화면 경계 검사 및 조정
    if (top + suggestionBox.offsetHeight > window.innerHeight + window.scrollY) {
        top = rect.top + window.scrollY - suggestionBox.offsetHeight;
    }
    if (left + suggestionBox.offsetWidth > window.innerWidth + window.scrollX) {
        left = window.innerWidth + window.scrollX - suggestionBox.offsetWidth - 5;
    }
    if (left < 5) {
        left = 5;
    }

    suggestionBox.style.top = `${top}px`;
    suggestionBox.style.left = `${left}px`;
    suggestionBox.style.width = `${Math.max(rect.width, 200)}px`;
}

// 제안 UI 숨김 함수
function hideSuggestionBox() {
    if (suggestionBox) {
        suggestionBox.style.display = 'none';
    }
    currentSlashMatch = null;
}

// 텍스트 대치 함수 (contentEditable 처리 개선)
function replaceText(element, textToReplace, newText, startIndexToReplace) {
    try {
        if (element.isContentEditable) {
            replaceTextInContentEditable(element, textToReplace, newText, startIndexToReplace);
        } else {
            replaceTextInInput(element, textToReplace, newText, startIndexToReplace);
        }

        // React 등 프레임워크 호환을 위한 이벤트 디스패치
        const inputEvent = new Event('input', { bubbles: true, cancelable: true });
        element.dispatchEvent(inputEvent);
        const changeEvent = new Event('change', { bubbles: true, cancelable: true });
        element.dispatchEvent(changeEvent);
    } catch (error) {
        console.error("텍스트 교체 중 오류:", error);
    }
}

// contentEditable 요소의 텍스트 교체 (개선된 버전)
function replaceTextInContentEditable(element, textToReplace, newText, startIndexToReplace) {
    const selection = window.getSelection();
    if (selection.rangeCount === 0) return;

    try {
        // 현재 커서 위치에서 역으로 textToReplace 찾기
        const range = selection.getRangeAt(0);
        const startContainer = range.startContainer;

        if (startContainer.nodeType === Node.TEXT_NODE) {
            const textContent = startContainer.textContent;
            const cursorOffset = range.startOffset;
            const searchStart = Math.max(0, cursorOffset - textToReplace.length);
            const textBefore = textContent.substring(searchStart, cursorOffset);

            if (textBefore === textToReplace) {
                // 정확히 일치하는 경우 교체
                const newTextContent = textContent.substring(0, searchStart) + 
                                     newText + 
                                     textContent.substring(cursorOffset);
                startContainer.textContent = newTextContent;

                // 커서 위치 재설정
                const newRange = document.createRange();
                const newCursorPos = searchStart + newText.length;
                newRange.setStart(startContainer, newCursorPos);
                newRange.setEnd(startContainer, newCursorPos);
                selection.removeAllRanges();
                selection.addRange(newRange);
                return;
            }
        }

        // Fallback: document.execCommand 사용
        for(let i = 0; i < textToReplace.length; i++) {
            document.execCommand('delete', false, null);
        }
        document.execCommand('insertText', false, newText);
    } catch (error) {
        console.error("contentEditable 텍스트 교체 실패:", error);
        // 최후의 수단: 전체 텍스트 교체
        const fullText = element.innerText || element.textContent || '';
        const newFullText = fullText.replace(new RegExp(textToReplace + '$'), newText);
        element.innerText = newFullText;
    }
}

// input/textarea 요소의 텍스트 교체 (수정됨)
function replaceTextInInput(element, textToReplace, newText, startIndexToReplace) {
    const originalValue = element.value || '';
    
    // 올바른 startIndex 사용
    const textBeforeReplacement = originalValue.substring(0, startIndexToReplace);
    const textAfterReplacement = originalValue.substring(startIndexToReplace + textToReplace.length);

    element.value = textBeforeReplacement + newText + textAfterReplacement;

    // 커서 위치 업데이트
    const newCursorPos = startIndexToReplace + newText.length;
    element.focus();
    element.setSelectionRange(newCursorPos, newCursorPos);
}

// 초기 로드 시 이미 포커스된 요소가 있을 수 있으므로 해당 요소에 리스너 추가
setTimeout(() => {
    try {
        if (document.activeElement && 
            document.activeElement.matches(targetInputSelectors) && 
            !elementsWithListeners.has(document.activeElement)) {
            currentInputElement = document.activeElement;
            currentInputElement.addEventListener('keydown', handleKeyDown, true);
            currentInputElement.addEventListener('input', handleInput);
            elementsWithListeners.add(document.activeElement);
            console.log("초기 포커스된 요소에 리스너 추가:", currentInputElement.tagName);
        }
    } catch (error) {
        console.error("초기 포커스 요소 처리 중 오류:", error);
    }
}, 500);
