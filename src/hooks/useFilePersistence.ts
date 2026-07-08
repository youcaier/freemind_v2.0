import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import type { MindMapData } from '@/types/mindmap';

const FILE_EXTENSION = 'freemind';
const FILE_FILTER = { name: 'Freemind', extensions: [FILE_EXTENSION] };

export function useFilePersistence() {
  const [currentPath, setCurrentPath] = useState<string | null>(null);

  const saveFile = async (data: MindMapData, path?: string) => {
    const targetPath =
      path ||
      (await save({
        defaultPath: `untitled.${FILE_EXTENSION}`,
        filters: [FILE_FILTER],
      }));

    if (!targetPath) return false;

    const content = JSON.stringify(data, null, 2);
    await invoke('write_text_file', { path: targetPath, content });
    setCurrentPath(targetPath);
    return true;
  };

  const openFile = async (): Promise<MindMapData | null> => {
    const selected = await open({
      filters: [FILE_FILTER],
      multiple: false,
    });
    if (!selected || Array.isArray(selected)) return null;

    const content = (await invoke('read_text_file', { path: selected })) as string;
    const data = JSON.parse(content) as MindMapData;
    setCurrentPath(selected);
    return data;
  };

  return { currentPath, saveFile, openFile };
}
