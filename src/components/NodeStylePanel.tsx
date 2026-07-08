import { useState } from 'react';
import type { NodeStyle } from '@/types/mindmap';

interface NodeStylePanelProps {
  style: NodeStyle | undefined;
  icon?: string;
  tags?: string[];
  priority?: number;
  progress?: number;
  note?: string;
  hyperlink?: string;
  onChange: (patch: {
    style?: NodeStyle;
    icon?: string;
    tags?: string[];
    priority?: number;
    progress?: number;
    note?: string;
    hyperlink?: string;
  }) => void;
  onClose: () => void;
}

const PRESET_COLORS = [
  '#fff', '#f5f5f5', '#ffe6e6', '#fff3cd', '#d4edda', '#d1ecf1', '#e2d4f0',
  '#ffcccc', '#ffeb99', '#b3e6b3', '#b3d9ff', '#e6ccff',
  '#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#9b59b6', '#e17055',
];

const PRESET_ICONS = ['⭐', '🔥', '💡', '⚠️', '✅', '❓', '❤️', '📌'];

export function NodeStylePanel({
  style,
  icon,
  tags,
  priority,
  progress,
  note,
  hyperlink,
  onChange,
  onClose,
}: NodeStylePanelProps) {
  const [localStyle, setLocalStyle] = useState<NodeStyle>(style || {});
  const [localTags, setLocalTags] = useState<string>((tags || []).join(', '));
  const [localIcon, setLocalIcon] = useState<string>(icon || '');
  const [localPriority, setLocalPriority] = useState<number>(priority ?? 0);
  const [localProgress, setLocalProgress] = useState<number>(progress ?? 0);
  const [localNote, setLocalNote] = useState<string>(note || '');
  const [localHyperlink, setLocalHyperlink] = useState<string>(hyperlink || '');

  const updateStyle = (patch: Partial<NodeStyle>) => {
    const next = { ...localStyle, ...patch };
    setLocalStyle(next);
    onChange({ style: next });
  };

  const updateTags = (value: string) => {
    setLocalTags(value);
    const next = value.split(/[,，]/).map((t) => t.trim()).filter(Boolean);
    onChange({ tags: next });
  };

  const updateIcon = (value: string) => {
    setLocalIcon(value);
    onChange({ icon: value || undefined });
  };

  const updatePriority = (value: number) => {
    setLocalPriority(value);
    onChange({ priority: value || undefined });
  };

  const updateProgress = (value: number) => {
    setLocalProgress(value);
    onChange({ progress: value || undefined });
  };

  const updateNote = (value: string) => {
    setLocalNote(value);
    onChange({ note: value || undefined });
  };

  const updateHyperlink = (value: string) => {
    setLocalHyperlink(value);
    onChange({ hyperlink: value || undefined });
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 1100,
        background: '#fff',
        border: '1px solid #ddd',
        borderRadius: 8,
        boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
        padding: 16,
        width: 280,
        maxHeight: '80vh',
        overflow: 'auto',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <strong>节点样式</strong>
        <button onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 18 }}>×</button>
      </div>

      <Section label="背景色">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {PRESET_COLORS.map((color) => (
            <button
              key={color}
              onClick={() => updateStyle({ background: color })}
              style={{
                width: 24,
                height: 24,
                borderRadius: 4,
                border: localStyle.background === color ? '2px solid #333' : '1px solid #ddd',
                background: color,
                cursor: 'pointer',
              }}
            />
          ))}
        </div>
      </Section>

      <Section label="文字颜色">
        <input
          type="color"
          value={localStyle.color || '#333333'}
          onChange={(e) => updateStyle({ color: e.target.value })}
          style={{ width: '100%', height: 32, border: 'none', cursor: 'pointer' }}
        />
      </Section>

      <Section label="边框颜色">
        <input
          type="color"
          value={localStyle.borderColor || '#4ECDC4'}
          onChange={(e) => updateStyle({ borderColor: e.target.value })}
          style={{ width: '100%', height: 32, border: 'none', cursor: 'pointer' }}
        />
      </Section>

      <Section label={`字号: ${localStyle.fontSize || 14}px`}>
        <input
          type="range"
          min={10}
          max={32}
          value={localStyle.fontSize || 14}
          onChange={(e) => updateStyle({ fontSize: Number(e.target.value) })}
          style={{ width: '100%' }}
        />
      </Section>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <ToggleButton active={localStyle.fontWeight === 'bold'} onClick={() => updateStyle({ fontWeight: localStyle.fontWeight === 'bold' ? 'normal' : 'bold' })}>
          B
        </ToggleButton>
        <ToggleButton active={localStyle.fontStyle === 'italic'} onClick={() => updateStyle({ fontStyle: localStyle.fontStyle === 'italic' ? 'normal' : 'italic' })}>
          I
        </ToggleButton>
        <ToggleButton active={localStyle.textDecoration === 'underline'} onClick={() => updateStyle({ textDecoration: localStyle.textDecoration === 'underline' ? 'none' : 'underline' })}>
          U
        </ToggleButton>
      </div>

      <Section label="形状">
        <div style={{ display: 'flex', gap: 8 }}>
          {(['rounded', 'rectangle', 'ellipse'] as const).map((shape) => (
            <button
              key={shape}
              onClick={() => updateStyle({ shape })}
              style={{
                flex: 1,
                padding: '6px 0',
                border: `1px solid ${localStyle.shape === shape ? '#4ECDC4' : '#ddd'}`,
                background: localStyle.shape === shape ? '#e6f9f7' : '#fff',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              {shape === 'rounded' ? '圆角' : shape === 'rectangle' ? '矩形' : '椭圆'}
            </button>
          ))}
        </div>
      </Section>

      <Section label="图标">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {PRESET_ICONS.map((ic) => (
            <button
              key={ic}
              onClick={() => updateIcon(localIcon === ic ? '' : ic)}
              style={{
                width: 28,
                height: 28,
                borderRadius: 4,
                border: `1px solid ${localIcon === ic ? '#4ECDC4' : '#ddd'}`,
                background: localIcon === ic ? '#e6f9f7' : '#fff',
                cursor: 'pointer',
              }}
            >
              {ic}
            </button>
          ))}
        </div>
      </Section>

      <Section label="标签（逗号分隔）">
        <input
          type="text"
          value={localTags}
          onChange={(e) => updateTags(e.target.value)}
          placeholder="标签1, 标签2"
          style={{ width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: 4 }}
        />
      </Section>

      <Section label={`优先级: ${localPriority || '无'}`}>
        <input
          type="range"
          min={0}
          max={5}
          value={localPriority}
          onChange={(e) => updatePriority(Number(e.target.value))}
          style={{ width: '100%' }}
        />
      </Section>

      <Section label={`进度: ${localProgress}%`}>
        <input
          type="range"
          min={0}
          max={100}
          value={localProgress}
          onChange={(e) => updateProgress(Number(e.target.value))}
          style={{ width: '100%' }}
        />
      </Section>

      <Section label="备注">
        <textarea
          value={localNote}
          onChange={(e) => updateNote(e.target.value)}
          placeholder="添加备注..."
          rows={3}
          style={{ width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: 4, resize: 'vertical' }}
        />
      </Section>

      <Section label="超链接">
        <input
          type="text"
          value={localHyperlink}
          onChange={(e) => updateHyperlink(e.target.value)}
          placeholder="https://..."
          style={{ width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: 4 }}
        />
      </Section>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}

function ToggleButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: '6px 12px',
        border: `1px solid ${active ? '#4ECDC4' : '#ddd'}`,
        background: active ? '#e6f9f7' : '#fff',
        borderRadius: 4,
        cursor: 'pointer',
        fontWeight: active ? 'bold' : 'normal',
      }}
    >
      {children}
    </button>
  );
}
