export default function ControlPanel({
  studyType,
  onRunLoadFlow,
  onRunShortCircuit,
  onLoadTemplate,
  selectedNode,
  onUpdateNode,
  selectedNodesCount,
  selectedEdgesCount,
  result,
  error,
  busCount,
  busNodes,
  shortCircuitFaultType,
  onShortCircuitFaultTypeChange,
  shortCircuitFaultBusId,
  onShortCircuitFaultBusIdChange
}) {
  const isLoadFlow = studyType === 'loadflow';
  const isShortCircuit = studyType === 'shortcircuit';
  const isProtection = studyType === 'protection';

  const panelTitle = isLoadFlow
    ? 'Load Flow Controls'
    : isShortCircuit
      ? 'Short Circuit Controls'
      : 'Protection Coordination Controls';

  return (
    <section className="controls">
      <h3>{panelTitle}</h3>
      <p>Buses: {busCount}/20</p>
      <p>Selected: {selectedNodesCount} nodes, {selectedEdgesCount} connectors</p>
      <div className="buttons">
        <button onClick={onLoadTemplate}>Load Demo Network</button>
        {isLoadFlow && <button onClick={onRunLoadFlow}>Run Load Flow</button>}
        {isShortCircuit && <button onClick={onRunShortCircuit}>Run Short Circuit</button>}
        {isProtection && <button disabled>Run Protection Check (Soon)</button>}
      </div>

      {isShortCircuit && (
        <div className="editor">
          <h4>Short Circuit Setup</h4>
          <label>
            Fault Type
            <select
              value={shortCircuitFaultType}
              onChange={(e) => onShortCircuitFaultTypeChange(e.target.value)}
            >
              <option value="three_phase">Three Phase</option>
              <option value="single_phase">Single Phase</option>
              <option value="earth_fault">Earth Fault</option>
            </select>
          </label>
          <label>
            Faulted Bus
            <select
              value={shortCircuitFaultBusId}
              onChange={(e) => onShortCircuitFaultBusIdChange(e.target.value)}
              disabled={busNodes.length === 0}
            >
              {busNodes.length === 0 && <option value="">No buses available</option>}
              {busNodes.map((busNode) => (
                <option key={busNode.id} value={busNode.id}>
                  {busNode.data.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {isProtection && (
        <div className="editor">
          <h4>Protection Setup</h4>
          <p>
            Define relay settings and coordination time intervals in this panel. Automated checks are
            currently being integrated.
          </p>
        </div>
      )}

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
                Motor Name
                <input
                  value={selectedNode.data.label}
                  onChange={(e) => onUpdateNode('label', e.target.value)}
                />
              </label>
              <label>
                Motor P (MW)
                <input
                  type="number"
                  step="0.1"
                  value={selectedNode.data.p_mw}
                  onChange={(e) => onUpdateNode('p_mw', Number(e.target.value))}
                />
              </label>
              <label>
                Motor Q (MVAr)
                <input
                  type="number"
                  step="0.1"
                  value={selectedNode.data.q_mvar}
                  onChange={(e) => onUpdateNode('q_mvar', Number(e.target.value))}
                />
              </label>
            </>
          )}

          {selectedNode.type === 'resistive_load' && (
            <>
              <label>
                Load Name
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


          {selectedNode.type === 'utility' && (
            <>
              <label>
                Name
                <input
                  value={selectedNode.data.label}
                  onChange={(e) => onUpdateNode('label', e.target.value)}
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

          {selectedNode.type === 'transformer' && (
            <>
              <label>
                Name
                <input
                  value={selectedNode.data.label}
                  onChange={(e) => onUpdateNode('label', e.target.value)}
                />
              </label>
              <label>
                HV (kV)
                <input
                  type="number"
                  step="0.1"
                  value={selectedNode.data.hv_kv}
                  onChange={(e) => onUpdateNode('hv_kv', Number(e.target.value))}
                />
              </label>
              <label>
                LV (kV)
                <input
                  type="number"
                  step="0.1"
                  value={selectedNode.data.lv_kv}
                  onChange={(e) => onUpdateNode('lv_kv', Number(e.target.value))}
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
