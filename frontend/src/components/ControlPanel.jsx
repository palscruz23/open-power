export default function ControlPanel({
  onRunLoadFlow,
  onRunShortCircuit,
  onLoadTemplate,
  selectedNode,
  onUpdateNode,
  result,
  error,
  busCount
}) {
  return (
    <section className="controls">
      <h3>Study Controls</h3>
      <p>Buses: {busCount}/20</p>
      <div className="buttons">
        <button onClick={onLoadTemplate}>Load Demo Network</button>
        <button onClick={onRunLoadFlow}>Run Load Flow</button>
        <button onClick={onRunShortCircuit}>Run Short Circuit</button>
      </div>

      {selectedNode && (
        <div className="editor">
          <h4>Edit {selectedNode.data.label}</h4>
          {selectedNode.type === 'bus' && (
            <>
              <label>
                Name
                <input
                  value={selectedNode.data.label}
                  onChange={(e) => onUpdateNode('label', e.target.value)}
                />
              </label>
              <label>
                Voltage (kV)
                <input
                  type="number"
                  step="0.1"
                  value={selectedNode.data.vn_kv}
                  onChange={(e) => onUpdateNode('vn_kv', Number(e.target.value))}
                />
              </label>
            </>
          )}
          {selectedNode.type === 'load' && (
            <>
              <label>
                Name
                <input
                  value={selectedNode.data.label}
                  onChange={(e) => onUpdateNode('label', e.target.value)}
                />
              </label>
              <label>
                P (MW)
                <input
                  type="number"
                  step="0.1"
                  value={selectedNode.data.p_mw}
                  onChange={(e) => onUpdateNode('p_mw', Number(e.target.value))}
                />
              </label>
              <label>
                Q (MVAr)
                <input
                  type="number"
                  step="0.1"
                  value={selectedNode.data.q_mvar}
                  onChange={(e) => onUpdateNode('q_mvar', Number(e.target.value))}
                />
              </label>
            </>
          )}
          {selectedNode.type === 'generator' && (
            <>
              <label>
                Name
                <input
                  value={selectedNode.data.label}
                  onChange={(e) => onUpdateNode('label', e.target.value)}
                />
              </label>
              <label>
                P (MW)
                <input
                  type="number"
                  step="0.1"
                  value={selectedNode.data.p_mw}
                  onChange={(e) => onUpdateNode('p_mw', Number(e.target.value))}
                />
              </label>
              <label>
                Vm (pu)
                <input
                  type="number"
                  step="0.01"
                  value={selectedNode.data.vm_pu}
                  onChange={(e) => onUpdateNode('vm_pu', Number(e.target.value))}
                />
              </label>
            </>
          )}
        </div>
      )}

      {error && <pre className="error">{error}</pre>}
      {result && <pre className="result">{JSON.stringify(result, null, 2)}</pre>}
    </section>
  );
}
