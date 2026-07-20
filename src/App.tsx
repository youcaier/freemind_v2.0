import { useCallback, useEffect, useRef, useState } from 'react';
import { MindMapCanvas, type MindMapCanvasRef } from '@/components/MindMapCanvas';
import { useMindMap } from '@/hooks/useMindMap';
import { useFilePersistence } from '@/hooks/useFilePersistence';
import { calculateTreeLayout } from '@/engine/mindmapEngine';
import type { MindMapData } from '@/types/mindmap';
import { ExportDialog } from '@/components/ExportDialog';
import { OutlinePanel } from '@/components/OutlinePanel';
import { exportMindMap, type ExportFormat, type ExportOptions } from '@/utils/export';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
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
    addChildNodes,
    addSiblingNode,
    deleteSelected,
    deleteSubtree,
    toggleSelected,
    copyNode,
    cutNode,
    pasteNode,
    moveNode,
    reorderNode,
    selectedIds,
    selectNodes,
    clipboard,
    undo,
    redo,
    canUndo,
    canRedo,
    moveSelection,
    changeLayout,
    changeConnectionStyle,
    changeConnectionColor,
    changeConnectionWidth,
    addRelation,
    setData,
  } = useMindMap();

  const {
    currentPath,
    recentFiles,
    isDirty,
    autoSave,
    lastSavedAt,
    setAutoSave,
    saveFile,
    saveAs,
    openFile,
    openRecentFile,
    markDirty,
  } = useFilePersistence();

  const canvasRef = useRef<MindMapCanvasRef>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchMatches, setSearchMatches] = useState<string[]>([]);
  const [searchIndex, setSearchIndex] = useState(0);
  const [scale, setScale] = useState(1);
  const [isPresentationMode, setIsPresentationMode] = useState(false);
  const isPresentationModeRef = useRef(isPresentationMode);
  isPresentationModeRef.current = isPresentationMode;
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'light';
    return (localStorage.getItem('freemind-theme') as 'light' | 'dark') || 'light';
  });
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showOutline, setShowOutline] = useState(false);
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  const handleExport = useCallback(async (format: ExportFormat, options: ExportOptions) => {
    const container = canvasContainerRef.current;
    if (!container) throw new Error('画布容器不存在');

    const { content, fileName } = await exportMindMap(container, data, theme, format, options);

    const targetPath = await save({
      defaultPath: fileName,
      filters: [{ name: '导出文件', extensions: [format === 'jpg' ? 'jpg' : format] }],
    });
    if (!targetPath) return;

    if (typeof content === 'string') {
      await invoke('write_text_file', { path: targetPath, content });
    } else {
      await invoke('write_binary_file', { path: targetPath, content: Array.from(content) });
    }
  }, [data, theme]);

  useEffect(() => {
    localStorage.setItem('freemind-theme', theme);
  }, [theme]);

  const searchKeywordRef = useRef(searchKeyword);
  const searchMatchesRef = useRef(searchMatches);
  const searchIndexRef = useRef(searchIndex);
  const prevSearchKeywordRef = useRef('');
  searchKeywordRef.current = searchKeyword;
  searchMatchesRef.current = searchMatches;
  searchIndexRef.current = searchIndex;

  const saveFileRef = useRef(saveFile);
  const saveAsRef = useRef(saveAs);
  const openFileRef = useRef(openFile);
  const openRecentFileRef = useRef(openRecentFile);
  const setDataRef = useRef(setData);
  const selectNodeRef = useRef(selectNode);
  const dataRef = useRef(data);
  const currentPathRef = useRef(currentPath);
  const isDirtyRef = useRef(isDirty);
  const autoSaveRef = useRef(autoSave);

  saveFileRef.current = saveFile;
  saveAsRef.current = saveAs;
  openFileRef.current = openFile;
  openRecentFileRef.current = openRecentFile;
  setDataRef.current = setData;
  selectNodeRef.current = selectNode;
  dataRef.current = data;
  currentPathRef.current = currentPath;
  isDirtyRef.current = isDirty;
  autoSaveRef.current = autoSave;

  // refs for hotkeys
  const startEditRef = useRef(startEdit);
  const commitEditRef = useRef(commitEdit);
  const editingIdRef = useRef(editingId);
  const addChildNodeRef = useRef(addChildNode);
  const addChildNodesRef = useRef(addChildNodes);
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
  const selectedIdsRef = useRef(selectedIds);

  const togglePresentation = useCallback(async () => {
    const next = !isPresentationMode;
    setIsPresentationMode(next);
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().setFullscreen(next);
  }, [isPresentationMode]);
  const togglePresentationRef = useRef(togglePresentation);

  startEditRef.current = startEdit;
  commitEditRef.current = commitEdit;
  editingIdRef.current = editingId;
  addChildNodeRef.current = addChildNode;
  addChildNodesRef.current = addChildNodes;
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
  selectedIdsRef.current = selectedIds;
  togglePresentationRef.current = togglePresentation;

  const lastSavedDataRef = useRef<MindMapData>(data);
  const skipDirtyRef = useRef(false);

  // 脏状态：数据相对最后保存/加载的内容发生变化时标记
  useEffect(() => {
    if (skipDirtyRef.current) {
      skipDirtyRef.current = false;
      lastSavedDataRef.current = data;
      return;
    }
    if (JSON.stringify(data) !== JSON.stringify(lastSavedDataRef.current)) {
      markDirty();
    }
  }, [data, markDirty]);

  // 保存成功后同步最后保存数据快照
  useEffect(() => {
    if (lastSavedAt) {
      lastSavedDataRef.current = data;
    }
  }, [lastSavedAt, data]);

  // 自动保存：每 30 秒检查一次，开启且有路径且脏时保存
  useEffect(() => {
    if (!autoSave) return;
    const id = setInterval(() => {
      if (isDirtyRef.current && currentPathRef.current) {
        saveFileRef.current(dataRef.current, currentPathRef.current);
      }
    }, 30000);
    return () => clearInterval(id);
  }, [autoSave]);

  // 关闭窗口前提示保存
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen('tauri://close-requested', (event) => {
        if (!isDirtyRef.current) return;

        // 阻止默认关闭行为，让用户选择是否保存
        const closeEvent = (event as unknown as { payload?: { preventDefault?: () => void } }).payload;
        closeEvent?.preventDefault?.();

        const shouldSave = window.confirm('有未保存的更改，是否保存后再关闭？');
        if (shouldSave) {
          saveFileRef.current(dataRef.current, currentPathRef.current ?? undefined).then(() => {
            import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
              getCurrentWindow().close();
            });
          });
        }
      }).then((fn) => {
        unlisten = fn;
      });
    });
    return () => {
      unlisten?.();
    };
  }, []);

  // 搜索逻辑：keyword 变化时重新计算匹配节点；data 变化时只更新匹配列表，
  // 不重置索引，避免添加节点等操作导致自动跳回第一个匹配。
  useEffect(() => {
    const keyword = searchKeyword.trim().toLowerCase();
    const keywordChanged = prevSearchKeywordRef.current !== searchKeyword;
    prevSearchKeywordRef.current = searchKeyword;

    if (!keyword) {
      setSearchMatches([]);
      setSearchIndex(0);
      return;
    }
    const matches = Object.values(data.nodes)
      .filter((node) => node.label.toLowerCase().includes(keyword))
      .map((node) => node.id);
    setSearchMatches(matches);
    if (keywordChanged) {
      setSearchIndex(matches.length > 0 ? 0 : 0);
    } else if (searchIndex >= matches.length) {
      setSearchIndex(matches.length > 0 ? 0 : 0);
    }
  }, [searchKeyword, data.nodes, data.version]);

  // 当前匹配节点变化时：选中并居中（仅在 keyword 或索引变化时触发，避免 data 变化干扰）
  useEffect(() => {
    if (searchMatches.length === 0) return;
    const currentId = searchMatches[searchIndex];
    if (!currentId) return;
    selectNode(currentId);
    canvasRef.current?.centerOnNode(currentId);
  }, [searchIndex, searchKeyword]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const hasModifier = e.ctrlKey || e.metaKey;
      const key = e.key;
      const lowerKey = key.toLowerCase();

      // 编辑状态下仅响应 Esc 提交/取消
      if (editingIdRef.current && key !== 'Escape') return;

      // Ctrl+F 聚焦搜索框
      if (hasModifier && lowerKey === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      // 搜索框聚焦时：Enter/Shift+Enter 切换匹配，Esc 清空
      const activeEl = document.activeElement;
      const isSearchFocused = activeEl === searchInputRef.current;
      if (isSearchFocused) {
        if (key === 'Enter') {
          e.preventDefault();
          if (searchMatchesRef.current.length > 0) {
            const delta = e.shiftKey ? -1 : 1;
            const next = (searchIndexRef.current + delta + searchMatchesRef.current.length) % searchMatchesRef.current.length;
            setSearchIndex(next);
          }
          return;
        } else if (key === 'Escape') {
          e.preventDefault();
          setSearchKeyword('');
          searchInputRef.current?.blur();
          return;
        }
      }

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
          if (loaded) {
            skipDirtyRef.current = true;
            setDataRef.current(calculateTreeLayout(loaded));
          }
        });
      } else if (hasModifier && lowerKey === 'n') {
        e.preventDefault();
        selectNodeRef.current(null);
        setDataRef.current(calculateTreeLayout({
          rootId: 'root',
          nodes: {
            root: { id: 'root', label: '中心主题', children: [], collapsed: false },
          },
          version: 1,
          layout: 'balanced',
          connectionStyle: 'bezier',
        }));
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
        if (selectedIdsRef.current && selectedIdsRef.current.size > 0) {
          addChildNodesRef.current(selectedIdsRef.current);
        } else if (selectedIdRef.current) {
          addChildNodeRef.current(selectedIdRef.current);
        }
      } else if (key === 'Delete' || key === 'Backspace') {
        e.preventDefault();
        deleteSelectedRef.current();
      } else if (key === ' ') {
        e.preventDefault();
        toggleSelectedRef.current();
      } else if (key === 'Escape') {
        e.preventDefault();
        if (isPresentationModeRef.current) {
          togglePresentationRef.current();
        } else if (editingIdRef.current) {
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
      } else if (key === 'F11') {
        e.preventDefault();
        togglePresentationRef.current();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    // 在捕获阶段阻止 WebView（尤其 Tauri/macOS WKWebView）对这些键的默认处理，
    // 避免 Tab/Space/Delete 等快捷键被系统提示音拦截或焦点切换吞掉。
    const captureKeys = new Set([
      'Tab', 'Insert', 'Delete', 'Backspace', 'Enter', 'F2', ' ', 'Space',
      'Escape', 'Home', 'End', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    ]);
    const captureHandler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
      if (isInput) return;
      const key = e.key;
      const lowerKey = key.toLowerCase();
      const hasModifier = e.ctrlKey || e.metaKey;
      const isShortcut = hasModifier && ['c', 'v', 'x', 's', 'o', 'n', 'z', 'y', 'a'].includes(lowerKey);
      if (captureKeys.has(key) || isShortcut) {
        e.preventDefault();
      }
    };
    document.addEventListener('keydown', captureHandler, true);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keydown', captureHandler, true);
    };
  }, []);

  return (
    <div className="app" data-theme={theme}>
      {!isPresentationMode && (
      <div className="toolbar">
        <button onClick={() => openFile().then((loaded) => {
          if (!loaded) return;
          skipDirtyRef.current = true;
          setData(calculateTreeLayout(loaded));
        })}>
          打开
        </button>
        <button onClick={() => saveFile(data, currentPath ?? undefined)}>保存</button>
        <button onClick={() => saveAs(data)}>另存为</button>
        {recentFiles.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              const path = e.target.value;
              if (!path) return;
              openRecentFile(path).then((loaded) => {
                if (loaded) {
                  skipDirtyRef.current = true;
                  setData(calculateTreeLayout(loaded));
                }
              }).catch(() => {});
            }}
            style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #ccc', fontSize: 13 }}
          >
            <option value="">最近文件</option>
            {recentFiles.map((path) => (
              <option key={path} value={path} title={path}>
                {path.split('/').pop() || path.split('\\').pop() || path}
              </option>
            ))}
          </select>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={autoSave}
            onChange={(e) => setAutoSave(e.target.checked)}
          />
          自动保存
        </label>
        <button onClick={() => {
          selectNode(null);
          setData(calculateTreeLayout({
            rootId: 'root',
            nodes: {
              root: { id: 'root', label: '中心主题', children: [], collapsed: false },
            },
            version: 1,
            layout: 'balanced',
            connectionStyle: 'bezier',
          }));
        }}>新建</button>
        <button onClick={undo} disabled={!canUndo}>
          撤销
        </button>
        <button onClick={redo} disabled={!canRedo}>
          重做
        </button>
        <button onClick={() => canvasRef.current?.centerView()}>居中</button>
        <button onClick={() => canvasRef.current?.zoomOut()} title="缩小">-</button>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 48, textAlign: 'center' }}>{Math.round(scale * 100)}%</span>
        <button onClick={() => canvasRef.current?.zoomIn()} title="放大">+</button>
        <button onClick={() => canvasRef.current?.resetZoom()} title="重置缩放">100%</button>
        <button onClick={() => canvasRef.current?.toggleMinimap()} title="切换迷你地图">🗺️</button>
        <button
          onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
          title="切换主题"
        >
          {theme === 'light' ? '🌙' : '☀️'}
        </button>
        <input
          ref={searchInputRef}
          type="text"
          value={searchKeyword}
          onChange={(e) => setSearchKeyword(e.target.value)}
          placeholder="搜索节点 (Ctrl+F)"
          style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #ccc', width: 160 }}
        />
        <select value={data.layout} onChange={(e) => changeLayout(e.target.value as typeof data.layout)}>
          <option value="balanced">左右平衡树</option>
          <option value="rightTree">右树</option>
          <option value="leftTree">左树</option>
          <option value="fishbone">鱼骨图</option>
          <option value="timeline">时间轴</option>
          <option value="org">组织结构图</option>
        </select>
        <select value={data.connectionStyle || 'bezier'} onChange={(e) => changeConnectionStyle(e.target.value as typeof data.connectionStyle)}>
          <option value="bezier">贝塞尔曲线</option>
          <option value="straight">直线</option>
          <option value="orthogonal">正交线</option>
          <option value="rounded">圆角折线</option>
        </select>
        <input
          type="color"
          value={data.connectionColor || '#999999'}
          onChange={(e) => changeConnectionColor(e.target.value)}
          title="连线颜色"
          style={{ width: 28, height: 24, padding: 0, border: 'none', cursor: 'pointer' }}
        />
        <input
          type="range"
          min={0.5}
          max={5}
          step={0.5}
          value={data.connectionWidth ?? 1.5}
          onChange={(e) => changeConnectionWidth(parseFloat(e.target.value))}
          title={`连线粗细：${data.connectionWidth ?? 1.5}px`}
          style={{ width: 80 }}
        />
        <span className="path">{currentPath || '未命名'}</span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#666' }}>
          selected: {selectedIds.size} | clipboard: {clipboard ? `${Object.keys(clipboard.nodes).length} nodes` : 'null'}
        </span>
        <button
          onClick={togglePresentation}
          title="全屏/演示模式 (F11)"
        >
          🖥️
        </button>
        <button
          onClick={() => {
            const ids = Array.from(selectedIds);
            if (ids.length === 2) {
              addRelation(ids[0], ids[1]);
            }
          }}
          disabled={selectedIds.size !== 2}
          title="添加关联线（需选中两个节点）"
        >
          🔗
        </button>
        <button
          onClick={() => setShowExportDialog(true)}
          title="导出图片/PDF"
        >
          导出
        </button>
        <button
          onClick={() => setShowOutline((v) => !v)}
          title="切换大纲视图"
          style={{ fontWeight: showOutline ? 'bold' : 'normal' }}
        >
          大纲
        </button>
      </div>
      )}
      <div className="main-content">
        <div className="canvas-container" ref={canvasContainerRef}>
          <MindMapCanvas
            ref={canvasRef}
            data={data}
            selectedId={selectedId}
            editingId={editingId}
            selectedIds={selectedIds}
            onSelect={selectNode}
            onSelectNodes={selectNodes}
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
            onMoveNode={moveNode}
            onReorderNode={reorderNode}
            onChangeStyle={changeNodeStyle}
            clipboard={clipboard}
            onUndo={undo}
            onRedo={redo}
            connectionStyle={data.connectionStyle || 'bezier'}
            highlightedIds={searchMatches}
            onScaleChange={setScale}
          />
        </div>
        {showOutline && (
          <OutlinePanel
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
            onMoveNode={moveNode}
            onReorderNode={reorderNode}
            onClose={() => setShowOutline(false)}
            theme={theme}
          />
        )}
      </div>
      <ExportDialog
        open={showExportDialog}
        theme={theme}
        onClose={() => setShowExportDialog(false)}
        onExport={handleExport}
      />
    </div>
  );
}

export default App;
