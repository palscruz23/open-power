import { useState } from 'react';

const items = [
  {
    key: 'bus',
    type: 'bus',
    label: 'Bus',
    preview: (
      <svg viewBox="0 0 88 48" aria-hidden="true">
        <line x1="8" y1="24" x2="80" y2="24" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
      </svg>
    )
  },
  {
    key: 'load',
    type: 'load',
    label: 'Motor',
    preview: (
      <svg viewBox="0 0 80 44" aria-hidden="true">
        <circle cx="40" cy="22" r="16" fill="none" stroke="currentColor" strokeWidth="3" />
        <path
          d="M31 30V14l9 10l9-10v16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  },
  {
    key: 'resistive_load',
    type: 'resistive_load',
    label: 'Resistive Load',
    preview: (
      <svg viewBox="0 0 80 44" aria-hidden="true">
        <rect x="24" y="8" width="32" height="28" fill="none" stroke="currentColor" strokeWidth="2.4" />
        <path
          d="M40 12v20M28 22h24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      </svg>
    )
  },
  {
    key: 'generator',
    type: 'generator',
    label: 'Generator',
    preview: (
      <svg viewBox="0 0 80 44" aria-hidden="true">
        <circle cx="40" cy="22" r="16" fill="none" stroke="currentColor" strokeWidth="3" />
        <path
          d="M28 22c2.8-6.7 6.2-6.7 9 0s6.2 6.7 9 0s6.2-6.7 9 0"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
    )
  },
  {
    key: 'utility',
    type: 'utility',
    label: 'Utility Grid',
    preview: (
      <svg viewBox="0 0 80 44" aria-hidden="true">
        <path
          d="M22 10h36L40 36z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.7"
          strokeLinejoin="round"
        />
        <path d="M30 33h20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    )
  },
  {
    key: 'transformer',
    type: 'transformer',
    label: 'Transformer',
    preview: (
      <svg viewBox="0 0 80 44" aria-hidden="true">
        <path d="M40 3v9" fill="none" stroke="currentColor" strokeWidth="2.3" />
        <path d="M40 32v9" fill="none" stroke="currentColor" strokeWidth="2.3" />
        <circle cx="40" cy="15.5" r="7.5" fill="none" stroke="currentColor" strokeWidth="2.4" />
        <circle cx="40" cy="28.5" r="7.5" fill="none" stroke="currentColor" strokeWidth="2.4" />
      </svg>
    )
  },
  {
    key: 'load-oc-relay',
    type: 'load',
    label: 'Motor Relay',
    protectionPreset: { device_type: 'oc_relay' },
    preview: (
      <svg viewBox="0 0 80 44" aria-hidden="true">
        <circle cx="30" cy="22" r="14" fill="none" stroke="currentColor" strokeWidth="3" />
        <path
          d="M22 29V15l8 8l8-8v14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <rect x="50" y="9" width="18" height="26" rx="3" fill="none" stroke="currentColor" strokeWidth="2.4" />
        <path d="M55 17h8M55 22h8M55 27h8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    )
  },
  {
    key: 'utility-recloser',
    type: 'utility',
    label: 'Feeder Recloser',
    protectionPreset: { device_type: 'recloser' },
    preview: (
      <svg viewBox="0 0 80 44" aria-hidden="true">
        <path
          d="M16 10h28L30 34z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        <path d="M21 31h16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="56" cy="16" r="5" fill="none" stroke="currentColor" strokeWidth="2.2" />
        <circle cx="56" cy="28" r="5" fill="none" stroke="currentColor" strokeWidth="2.2" />
        <path d="M61 12l4-4M61 32l4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    )
  },
  {
    key: 'resistive-load-fuse',
    type: 'resistive_load',
    label: 'Fused Load',
    protectionPreset: { device_type: 'fuse' },
    preview: (
      <svg viewBox="0 0 80 44" aria-hidden="true">
        <rect x="13" y="10" width="22" height="24" fill="none" stroke="currentColor" strokeWidth="2.3" />
        <path d="M24 15v14M18 22h12" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
        <path d="M44 22h6M60 22h6" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" />
        <path d="M50 16l10 12" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" />
        <path d="M50 28l10-12" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" />
      </svg>
    )
  },
  {
    key: 'transformer-oc-relay',
    type: 'transformer',
    label: 'TX Relay',
    protectionPreset: { device_type: 'oc_relay' },
    preview: (
      <svg viewBox="0 0 80 44" aria-hidden="true">
        <path d="M24 3v9" fill="none" stroke="currentColor" strokeWidth="2.1" />
        <path d="M24 32v9" fill="none" stroke="currentColor" strokeWidth="2.1" />
        <circle cx="24" cy="15.5" r="7.5" fill="none" stroke="currentColor" strokeWidth="2.2" />
        <circle cx="24" cy="28.5" r="7.5" fill="none" stroke="currentColor" strokeWidth="2.2" />
        <rect x="46" y="9" width="18" height="26" rx="3" fill="none" stroke="currentColor" strokeWidth="2.2" />
        <path d="M51 17h8M51 22h8M51 27h8" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      </svg>
    )
  }
];

export default function Palette() {
  const [selectedType, setSelectedType] = useState(null);

  const onDragStart = (event, item) => {
    event.dataTransfer.setData(
      'application/reactflow',
      JSON.stringify({
        type: item.type,
        protectionPreset: item.protectionPreset || null
      })
    );
    event.dataTransfer.effectAllowed = 'move';
    setSelectedType(item.key);
  };

  return (
    <aside className="palette">
      <h3>Components</h3>
      <p>Drag assets or protection-ready presets into canvas.</p>
      <div className="palette-grid">
        {items.map((item) => (
          <div
            className={`palette-item palette-item--${item.type} ${
              item.protectionPreset ? 'palette-item--protection' : ''
            } ${selectedType === item.key ? 'palette-item--selected' : ''}`}
            key={item.key}
            role="button"
            tabIndex={0}
            draggable
            onClick={() => setSelectedType(item.key)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setSelectedType(item.key);
              }
            }}
            onDragStart={(event) => onDragStart(event, item)}
          >
            <div className="palette-item__preview">{item.preview}</div>
            <div className="palette-item__label">{item.label}</div>
          </div>
        ))}
      </div>
    </aside>
  );
}
