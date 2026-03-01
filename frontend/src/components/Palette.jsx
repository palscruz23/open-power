import { useState } from 'react';

const items = [
  {
    type: 'bus',
    label: 'Bus',
    preview: (
      <svg viewBox="0 0 88 48" aria-hidden="true">
        <line x1="8" y1="24" x2="80" y2="24" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
      </svg>
    )
  },
  {
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
  }
];

export default function Palette() {
  const [selectedType, setSelectedType] = useState(null);

  const onDragStart = (event, type) => {
    event.dataTransfer.setData('application/reactflow', type);
    event.dataTransfer.effectAllowed = 'move';
    setSelectedType(type);
  };

  return (
    <aside className="palette">
      <h3>Components</h3>
      <p>Drag items into canvas.</p>
      <div className="palette-grid">
        {items.map((item) => (
          <div
            className={`palette-item palette-item--${item.type} ${
              selectedType === item.type ? 'palette-item--selected' : ''
            }`}
            key={item.type}
            role="button"
            tabIndex={0}
            draggable
            onClick={() => setSelectedType(item.type)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setSelectedType(item.type);
              }
            }}
            onDragStart={(event) => onDragStart(event, item.type)}
          >
            <div className="palette-item__preview">{item.preview}</div>
            <div className="palette-item__label">{item.label}</div>
          </div>
        ))}
      </div>
    </aside>
  );
}
