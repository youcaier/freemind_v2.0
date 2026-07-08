import { useEffect, useRef } from 'react';
import { MindMapCanvas } from '@/components/MindMapCanvas';
import { useMindMap } from '@/hooks/useMindMap';
import { useFilePersistence } from '@/hooks/useFilePersistence';
import { calculateTreeLayout } from '@/engine/mindmapEngine';
import './App.css';

function App() {
  const {
    data,
    selectedId,
    editingId,
    selectNode,
    startEdit,
    commitEdit,
    changeNodeStyle,
    addChildNode,
    addSiblingNode,
    deleteSelected,
    deleteSubtree,
    toggleSelected,
    copyNode,
    cutNode,
    pasteNode,
    clipboard,
    undo,
    redo,
    canUndo,
    canRedo,
    moveSelection,
    handleCanvasClick,
    handleCanvasDoubleClick,
    setData,
  } = useMindMap();

  const { currentPath, saveFile, openFile } = useFilePersistence();

  const saveFileRef = useRef(saveFile);
  const openFileRef = useRef(openFile);
  const setDataRef = useRef(setData);
  const selectNodeRef = useRef(selectNode);
  const dataRef = useRef(data);
  const currentPathRef = useRef(currentPath);

  saveFileRef.current = saveFile;
  openFileRef.current = openFile;
  setDataRef.current = setData;
  selectNodeRef.current = selectNode;
  dataRef.current = data;
  currentPathRef.current = currentPath;

  // refs for hotkeys
  const startEditRef = useRef(startEdit);
  const commitEditRef = useRef(commitEdit);
  const editingIdRef = useRef(editingId);
  const addChildNodeRef = useRef(addChildNode);
  const addSiblingNodeRef = useRef(addSiblingNode);
  const deleteSelectedRef = useRef(deleteSelected);
  const deleteSubtreeRef = useRef(deleteSubtree);
  const toggleSelectedRef = useRef(toggleSelected);
  const copyNodeRef = useRef(copyNode);
  const cutNodeRef = useRef(cutNode);
  const pasteNodeRef = useRef(pasteNode);
  const undoRef = useRef(undo);
  const redoRef = useRef(redo);
  const moveSelectionRef = useRef(moveSelection);
  const selectedIdRef = useRef(selectedId);

  startEditRef.current = startEdit;
  commitEditRef.current = commitEdit;
  editingIdRef.current = editingId;
  addChildNodeRef.current = addChildNode;
  addSiblingNodeRef.current = addSiblingNode;
  deleteSelectedRef.current = deleteSelected;
  deleteSubtreeRef.current = deleteSubtree;
  toggleSelectedRef.current = toggleSelected;
  copyNodeRef.current = copyNode;
  cutNodeRef.current = cutNode;
  pasteNodeRef.current = pasteNode;
  undoRef.current = undo;
  redoRef.current = redo;
  moveSelectionRef.current = moveSelection;
  selectedIdRef.current = selectedId;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      console.log('[handleKeyDown] key=', e.key, 'code=', e.code, 'ctrl=', e.ctrlKey, 'meta=', e.metaKey, 'shift=', e.shiftKey);
      const hasModifier = e.ctrlKey || e.metaKey;
      const key = e.key;
      const lowerKey = key.toLowerCase();

      // 编辑状态下仅响应 Esc 提交/取消
      if (editingIdRef.current && key !== 'Escape') return;

      if (hasModifier && lowerKey === 'c') {
        e.preventDefault();
        if (selectedIdRef.current) copyNodeRef.current(selectedIdRef.current);
      } else if (hasModifier && lowerKey === 'v') {
        e.preventDefault();
        if (selectedIdRef.current) pasteNodeRef.current(selectedIdRef.current);
      } else if (hasModifier && lowerKey === 'x') {
        e.preventDefault();
        if (selectedIdRef.current) cutNodeRef.current(selectedIdRef.current);
      } else if (hasModifier && lowerKey === 's') {
        e.preventDefault();
        saveFileRef.current(dataRef.current, currentPathRef.current ?? undefined);
      } else if (hasModifier && lowerKey === 'o') {
        e.preventDefault();
        openFileRef.current().then((loaded) => {
          if (loaded) setDataRef.current(calculateTreeLayout(loaded));
        });
      } else if (hasModifier && lowerKey === 'n') {
        e.preventDefault();
        selectNodeRef.current(null);
        setDataRef.current({
          rootId: 'root',
          nodes: {
            root: { id: 'root', label: '中心主题', children: [], collapsed: false },
          },
          version: 1,
        });
      } else if (hasModifier && lowerKey === 'z') {
        e.preventDefault();
        if (e.shiftKey) redoRef.current();
        else undoRef.current();
      } else if (hasModifier && lowerKey === 'y') {
        e.preventDefault();
        redoRef.current();
      } else if (hasModifier && (key === 'Delete' || key === 'Backspace')) {
        e.preventDefault();
        deleteSubtreeRef.current();
      } else if (hasModifier && (key === 'Insert' || e.code === 'Insert' || key === 'Help')) {
        e.preventDefault();
        if (selectedIdRef.current) addSiblingNodeRef.current(selectedIdRef.current);
      } else if (hasModifier && key === 'Enter') {
        e.preventDefault();
        if (selectedIdRef.current) addSiblingNodeRef.current(selectedIdRef.current);
      } else if (key === 'Enter' || key === 'F2') {
        e.preventDefault();
        if (selectedIdRef.current) startEditRef.current(selectedIdRef.current);
      } else if (key === 'Insert' || e.code === 'Insert' || key === 'Help') {
        e.preventDefault();
        if (selectedIdRef.current) addChildNodeRef.current(selectedIdRef.current);
      } else if (key === 'Tab') {
        e.preventDefault();
        if (selectedIdRef.current) addChildNodeRef.current(selectedIdRef.current);
      } else if (key === 'Delete' || key === 'Backspace') {
        e.preventDefault();
        deleteSelectedRef.current();
      } else if (key === ' ') {
        e.preventDefault();
        toggleSelectedRef.current();
      } else if (key === 'Escape') {
        e.preventDefault();
        if (editingIdRef.current) {
          commitEditRef.current(editingIdRef.current, dataRef.current.nodes[editingIdRef.current]?.label ?? '');
        } else {
          selectNodeRef.current(null);
        }
      } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) {
        e.preventDefault();
        const dir = key.replace('Arrow', '').toLowerCase() as 'up' | 'down' | 'left' | 'right';
        moveSelectionRef.current(dir);
      } else if (key === 'Home') {
        e.preventDefault();
        moveSelectionRef.current('home');
      } else if (key === 'End') {
        e.preventDefault();
        moveSelectionRef.current('end');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="app">
      <div className="toolbar">
        <button onClick={() => openFile().then((loaded) => loaded && setData(calculateTreeLayout(loaded)))}>
          打开
        </button>
        <button onClick={() => saveFile(data, currentPath ?? undefined)}>保存</button>
        <button onClick={undo} disabled={!canUndo}>
          撤销
        </button>
        <button onClick={redo} disabled={!canRedo}>
          重做
        </button>
        <span className="path">{currentPath || '未命名'}</span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#666' }}>
          selectedId: {selectedId ?? 'null'} | clipboard: {clipboard ? `${Object.keys(clipboard.nodes).length} nodes` : 'null'}
        </span>
      </div>
      <div className="canvas-container">
        <MindMapCanvas
          data={data}
          selectedId={selectedId}
          editingId={editingId}
          onSelect={selectNode}
          onStartEdit={startEdit}
          onCommitEdit={commitEdit}
          onAddChild={addChildNode}
          onAddSibling={addSiblingNode}
          onDelete={deleteSelected}
          onDeleteSubtree={deleteSubtree}
          onToggle={toggleSelected}
          onCopy={copyNode}
          onCut={cutNode}
          onPaste={pasteNode}
          onChangeStyle={changeNodeStyle}
          clipboard={clipboard}
          onUndo={undo}
          onRedo={redo}
          onClick={handleCanvasClick}
          onDoubleClick={handleCanvasDoubleClick}
        />
      </div>
    </div>
  );
}

export default App;
