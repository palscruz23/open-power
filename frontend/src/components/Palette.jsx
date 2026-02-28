const items = [
  { type: 'bus', label: 'Bus' },
  { type: 'load', label: 'Load' },
  { type: 'generator', label: 'Generator' }
];

export default function Palette() {
  const onDragStart = (event, type) => {
    event.dataTransfer.setData('application/reactflow', type);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <aside className="palette">
      <h3>Components</h3>
      <p>Drag items into canvas.</p>
      {items.map((item) => (
        <div
          className="palette-item"
          key={item.type}
          draggable
          onDragStart={(event) => onDragStart(event, item.type)}
        >
          {item.label}
        </div>
      ))}
    </aside>
  );
}
