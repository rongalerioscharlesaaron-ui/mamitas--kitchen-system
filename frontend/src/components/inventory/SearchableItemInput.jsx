import { useEffect, useMemo, useRef, useState } from 'react';

const GROUP_LABELS = {
  ingredient: 'Ingredients',
  food: 'Foods',
  food_tray: 'Food trays',
};

export default function SearchableItemInput({
  id,
  label = '1. Item',
  items,
  value,
  onChange,
  placeholder = 'Type to search item...',
  autoFocus = false,
}) {
  const wrapRef = useRef(null);
  const selectedItem = useMemo(
    () => items.find((i) => String(i.id) === String(value)) || null,
    [items, value]
  );

  const [queryText, setQueryText] = useState(selectedItem ? selectedItem.name : '');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setQueryText(selectedItem ? selectedItem.name : '');
  }, [selectedItem]);

  useEffect(() => {
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
        setQueryText(selectedItem ? selectedItem.name : '');
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [selectedItem]);

  const filtered = useMemo(() => {
    const q = queryText.trim().toLowerCase();
    if (!q || (selectedItem && queryText.trim().toLowerCase() === selectedItem.name.toLowerCase())) {
      return items;
    }
    return items.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        (i.category && i.category.toLowerCase().includes(q))
    );
  }, [items, queryText, selectedItem]);

  const grouped = useMemo(() => {
    const map = new Map();
    filtered.forEach((item) => {
      const key = item.type || 'other';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    });
    return Array.from(map.entries());
  }, [filtered]);

  const handleInput = (e) => {
    const nextText = e.target.value;
    setQueryText(nextText);
    setOpen(true);
    if (!nextText.trim()) {
      onChange('');
    } else if (selectedItem && nextText.trim().toLowerCase() !== selectedItem.name.toLowerCase()) {
      onChange('');
    }
  };

  const handleSelect = (item) => {
    onChange(String(item.id));
    setQueryText(item.name);
    setOpen(false);
  };

  return (
    <div className="field" ref={wrapRef} style={{ position: 'relative' }}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={queryText}
        onFocus={() => setOpen(true)}
        onChange={handleInput}
      />

      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 40,
            maxHeight: 220,
            overflowY: 'auto',
            background: '#fff',
            border: '1px solid var(--border, #d1d5db)',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)',
            marginTop: 4,
          }}
        >
          {grouped.length === 0 ? (
            <div style={{ padding: '10px 12px', color: 'var(--muted, #6b7280)', fontSize: '0.9rem' }}>
              No matching items.
            </div>
          ) : (
            grouped.map(([type, list]) => (
              <div key={type}>
                <div
                  style={{
                    padding: '6px 12px',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    background: 'var(--cream, #faf6f0)',
                    color: 'var(--muted, #6b7280)',
                  }}
                >
                  {GROUP_LABELS[type] || type}
                </div>
                {list.map((item) => {
                  const active = String(item.id) === String(value);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleSelect(item);
                      }}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        padding: '8px 12px',
                        border: 'none',
                        background: active ? 'var(--cream, #faf6f0)' : 'transparent',
                        fontWeight: active ? 600 : 400,
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span>{item.name}</span>
                      {item.unit && (
                        <span style={{ fontSize: '0.8rem', color: 'var(--muted, #6b7280)' }}>
                          {item.unit}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}