import { useCallback, useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import type { MindMapData } from '@/types/mindmap';
import { parseMarkdownToMindMap } from '@/utils/importMarkdown';

const FILE_EXTENSION = 'freemind';
const FILE_FILTER = { name: 'Freemind', extensions: [FILE_EXTENSION] };
const MARKDOWN_FILTER = { name: 'Markdown', extensions: ['md', 'markdown'] };
const RECENT_FILES_KEY = 'freemind-recent-files';
const AUTO_SAVE_KEY = 'freemind-auto-save';
const MAX_RECENT_FILES = 10;

function loadRecentFiles(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_FILES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((p) => typeof p === 'string');
  } catch {
    // ignore
  }
  return [];
}

function saveRecentFiles(files: string[]) {
  localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(files.slice(0, MAX_RECENT_FILES)));
}

function loadAutoSaveSetting(): boolean {
  try {
    return localStorage.getItem(AUTO_SAVE_KEY) === 'true';
  } catch {
    return false;
  }
}

// 兼容旧文件：cards 字段可选；旧版便签墙卡片没有 nodeId（或所属节点已不存在）时直接过滤掉
function sanitizeCards(data: MindMapData) {
  if (data.cards) {
    data.cards = data.cards.filter((c) => c.nodeId && data.nodes[c.nodeId]);
  }
}

function generateDefaultFileName(): string {  const now = new Date();
  const yyyy = now.getFullYear();
  const MM = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${yyyy}${MM}${dd}${hh}${mm}${ss}.${FILE_EXTENSION}`;
}

export function useFilePersistence() {
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [recentFiles, setRecentFiles] = useState<string[]>(loadRecentFiles);
  const [isDirty, setIsDirty] = useState(false);
  const [autoSave, setAutoSave] = useState<boolean>(loadAutoSaveSetting);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  useEffect(() => {
    localStorage.setItem(AUTO_SAVE_KEY, autoSave ? 'true' : 'false');
  }, [autoSave]);

  const markDirty = useCallback(() => setIsDirty(true), []);
  const clearDirty = useCallback(() => setIsDirty(false), []);

  const addRecentFile = useCallback((path: string) => {
    setRecentFiles((prev) => {
      const next = [path, ...prev.filter((p) => p !== path)];
      saveRecentFiles(next);
      return next;
    });
  }, []);

  const removeRecentFile = useCallback((path: string) => {
    setRecentFiles((prev) => {
      const next = prev.filter((p) => p !== path);
      saveRecentFiles(next);
      return next;
    });
  }, []);

  const saveFile = useCallback(
    async (data: MindMapData, path?: string): Promise<string | null> => {
      const targetPath =
        path ||
        currentPath ||
        (await save({
          defaultPath: generateDefaultFileName(),
          filters: [FILE_FILTER],
        }));

      if (!targetPath) return null;

      const content = JSON.stringify(data, null, 2);
      await invoke('write_text_file', { path: targetPath, content });
      setCurrentPath(targetPath);
      addRecentFile(targetPath);
      setIsDirty(false);
      setLastSavedAt(Date.now());
      return targetPath;
    },
    [currentPath, addRecentFile]
  );

  const saveAs = useCallback(
    async (data: MindMapData): Promise<string | null> => {
      const targetPath = await save({
        defaultPath: currentPath || generateDefaultFileName(),
        filters: [FILE_FILTER],
      });
      if (!targetPath) return null;

      const content = JSON.stringify(data, null, 2);
      await invoke('write_text_file', { path: targetPath, content });
      setCurrentPath(targetPath);
      addRecentFile(targetPath);
      setIsDirty(false);
      setLastSavedAt(Date.now());
      return targetPath;
    },
    [currentPath, addRecentFile]
  );

  const openFile = useCallback(async (): Promise<MindMapData | null> => {
    const selected = await open({
      filters: [FILE_FILTER],
      multiple: false,
    });
    if (!selected || Array.isArray(selected)) return null;

    const content = (await invoke('read_text_file', { path: selected })) as string;
    const data = JSON.parse(content) as MindMapData;
    if (!data.layout) data.layout = 'balanced';
    if (!data.connectionStyle) data.connectionStyle = 'bezier';
    sanitizeCards(data);
    setCurrentPath(selected);
    addRecentFile(selected);
    setIsDirty(false);
    return data;
  }, [addRecentFile]);

  const openRecentFile = useCallback(
    async (path: string): Promise<MindMapData | null> => {
      try {
        const content = (await invoke('read_text_file', { path })) as string;
        const data = JSON.parse(content) as MindMapData;
        if (!data.layout) data.layout = 'balanced';
        if (!data.connectionStyle) data.connectionStyle = 'bezier';
        sanitizeCards(data);
        setCurrentPath(path);
        addRecentFile(path);
        setIsDirty(false);
        return data;
      } catch (e) {
        // 文件不存在或损坏时从最近列表移除
        removeRecentFile(path);
        throw e;
      }
    },
    [addRecentFile, removeRecentFile]
  );

  // 导入 Markdown：解析为一张未保存的新脑图（清空当前路径、置脏，不加入最近文件）
  const importMarkdownFile = useCallback(async (): Promise<MindMapData | null> => {
    const selected = await open({
      filters: [MARKDOWN_FILTER],
      multiple: false,
    });
    if (!selected || Array.isArray(selected)) return null;

    const content = (await invoke('read_text_file', { path: selected })) as string;
    const data = parseMarkdownToMindMap(content);
    setCurrentPath(null);
    setIsDirty(true);
    return data;
  }, []);

  return {
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
    importMarkdownFile,
    markDirty,
    clearDirty,
  };
}
