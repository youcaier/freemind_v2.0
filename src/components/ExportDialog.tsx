import { useState } from 'react';
import type { ExportFormat, ExportOptions } from '@/utils/export';

export interface ExportDialogProps {
  open: boolean;
  theme: 'light' | 'dark';
  onClose: () => void;
  onExport: (format: ExportFormat, options: ExportOptions) => Promise<void>;
}

const FORMATS: { value: ExportFormat; label: string; ext: string }[] = [
  { value: 'png', label: 'PNG 图片', ext: 'png' },
  { value: 'jpg', label: 'JPG 图片', ext: 'jpg' },
  { value: 'svg', label: 'SVG 矢量图', ext: 'svg' },
  { value: 'pdf', label: 'PDF 文档', ext: 'pdf' },
];

const BACKGROUNDS: { value: ExportOptions['background']; label: string }[] = [
  { value: 'light', label: '浅色背景' },
  { value: 'dark', label: '深色背景' },
  { value: 'transparent', label: '透明背景' },
];

export function ExportDialog({ open, theme, onClose, onExport }: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>('png');
  const [scale, setScale] = useState(2);
  const [padding, setPadding] = useState(40);
  const [background, setBackground] = useState<ExportOptions['background']>(theme);
  const [quality, setQuality] = useState(0.92);
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleExport = async () => {
    setLoading(true);
    setError(null);
    try {
      // 让 loading 状态先渲染，避免长时间导出阻塞 UI 更新
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      await onExport(format, {
        scale,
        padding,
        background,
        quality,
        fileName: fileName.trim() || undefined,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg-toolbar)',
          color: 'var(--text-primary)',
          borderRadius: 12,
          boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
          width: 420,
          maxWidth: '90vw',
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>导出图片 / PDF</h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>导出格式</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {FORMATS.map((f) => (
              <button
                key={f.value}
                onClick={() => setFormat(f.value)}
                style={{
                  flex: 1,
                  minWidth: 80,
                  padding: '8px 12px',
                  border: `1px solid ${format === f.value ? 'var(--accent-color)' : 'var(--border-color)'}`,
                  borderRadius: 6,
                  background: format === f.value ? 'var(--accent-shadow)' : 'var(--bg-toolbar)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>背景</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {BACKGROUNDS.map((b) => (
              <button
                key={b.label}
                onClick={() => setBackground(b.value)}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  border: `1px solid ${background === b.value ? 'var(--accent-color)' : 'var(--border-color)'}`,
                  borderRadius: 6,
                  background: background === b.value ? 'var(--accent-shadow)' : 'var(--bg-toolbar)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                }}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 16 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>缩放倍数 ({scale}x)</label>
            <input
              type="range"
              min={1}
              max={4}
              step={1}
              value={scale}
              onChange={(e) => setScale(parseInt(e.target.value, 10))}
              style={{ width: '100%' }}
            />
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>边距 ({padding}px)</label>
            <input
              type="range"
              min={0}
              max={120}
              step={10}
              value={padding}
              onChange={(e) => setPadding(parseInt(e.target.value, 10))}
              style={{ width: '100%' }}
            />
          </div>
        </div>

        {format === 'jpg' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>JPG 质量 ({Math.round(quality * 100)}%)</label>
            <input
              type="range"
              min={0.5}
              max={1}
              step={0.05}
              value={quality}
              onChange={(e) => setQuality(parseFloat(e.target.value))}
              style={{ width: '100%' }}
            />
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>文件名（可选）</label>
          <input
            type="text"
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            placeholder={`freemind_${new Date().getTime()}`}
            style={{
              padding: '8px 10px',
              borderRadius: 6,
              border: '1px solid var(--border-color)',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              fontSize: 14,
            }}
          />
        </div>

        {error && (
          <div style={{ color: '#ff6b6b', fontSize: 13, padding: '8px 0' }}>{error}</div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
          <button
            onClick={onClose}
            disabled={loading}
            style={{
              padding: '8px 16px',
              borderRadius: 6,
              border: '1px solid var(--border-color)',
              background: 'var(--bg-toolbar)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
            }}
          >
            取消
          </button>
          <button
            onClick={handleExport}
            disabled={loading}
            style={{
              padding: '8px 16px',
              borderRadius: 6,
              border: 'none',
              background: 'var(--accent-color)',
              color: '#fff',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? '导出中...' : '导出'}
          </button>
        </div>
      </div>
    </div>
  );
}
