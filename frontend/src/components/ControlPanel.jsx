import { formatCurrentFromKa, formatVoltageFromKv } from '../utils/unitFormat';

function getShortCircuitCurrentTag(fault) {
  if (!fault) return 'Isc';
  if (fault.standard === 'ansi' && fault.current_type === 'initial_symmetrical') return 'Isym';
  if (fault.current_result_key === 'ikss_ka') return 'Ikss';
  if (fault.current_result_key === 'ip_ka') return 'Ip';
  if (fault.current_result_key === 'ith_ka') return 'Ith';
  return 'Isc';
}

function formatBranchEndpoint(branches, branchId) {
  const branch = branches?.[branchId];
  if (!branch) return branchId;
  const fromBus = branch.from_bus_id || '?';
  const toBus = branch.to_bus_id || '?';
  return `${fromBus} -> ${toBus}`;
}

function renderShortCircuitResults(result) {
  const fault = result?.fault;
  const faultBus = result?.fault_bus;
  const limitations = Array.isArray(fault?.limitations) ? fault.limitations : [];
  const branches = Object.entries(result?.branches || {});
  const branchRows = branches
    .map(([branchId, branch]) => {
      const preferredValue =
        branch?.[branch?.result_key] ??
        branch?.current_ka ??
        branch?.contribution_ka ??
        branch?.from_current_ka ??
        branch?.to_current_ka;
      const numericValue = Number(preferredValue);
      return Number.isFinite(numericValue) && numericValue > 0
        ? {
            branchId,
            endpoint: formatBranchEndpoint(result?.branches, branchId),
            label: branch?.result_label || fault?.current_type_label || 'Short-circuit current',
            currentKa: numericValue
          }
        : {
            branchId,
            endpoint: formatBranchEndpoint(result?.branches, branchId),
            label: branch?.result_label || fault?.current_type_label || 'Short-circuit current',
            currentKa: null
          };
    })
    .slice(0, 8);
  const currentTag = getShortCircuitCurrentTag(fault);

  return (
    <div className="study-result study-result--shortcircuit">
      <h4>Short-Circuit Results</h4>
      <div className="result-summary-grid">
        <div>
          <span>Standard</span>
          <strong>{fault?.standard_label || 'Unknown'}</strong>
        </div>
        <div>
          <span>Current Type</span>
          <strong>
            {currentTag}
            {fault?.current_type_label ? ` - ${fault.current_type_label}` : ''}
          </strong>
        </div>
        <div>
          <span>Fault Bus</span>
          <strong>{fault?.bus_id || '-'}</strong>
        </div>
        <div>
          <span>Fault Current</span>
          <strong>
            {faultBus?.current_ka != null ? formatCurrentFromKa(faultBus.current_ka) : 'Not available'}
          </strong>
        </div>
        <div>
          <span>Voltage Base</span>
          <strong>
            {faultBus?.voltage_level_kv != null
              ? formatVoltageFromKv(faultBus.voltage_level_kv)
              : 'Not available'}
          </strong>
        </div>
      </div>

      {fault?.engine_note && <p className="result-note">{fault.engine_note}</p>}

      <div className="result-section">
        <h5>Branch Contributions</h5>
        {branchRows.length > 0 ? (
          <div className="result-list">
            {branchRows.map((branch) => (
              <div className="result-list-row" key={branch.branchId}>
                <div>
                  <strong>{branch.endpoint}</strong>
                  <span>{branch.label}</span>
                </div>
                <div>{branch.currentKa != null ? formatCurrentFromKa(branch.currentKa) : 'Not available'}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="result-empty">
            Branch contribution values were not returned for this study case.
          </p>
        )}
      </div>

      <div className="result-section">
        <h5>Limitations</h5>
        {limitations.length > 0 ? (
          <ul className="result-limitations">
            {limitations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className="result-empty">No standard-specific limitations were reported for this result.</p>
        )}
      </div>
    </div>
  );
}

export default function ControlPanel({
  studyType,
  onRunLoadFlow,
  onRunShortCircuit,
  selectedNode,
  onUpdateNode,
  selectedNodesCount,
  selectedEdgesCount,
  result,
  error,
  busCount,
  busNodes,
  shortCircuitStandard,
  onShortCircuitStandardChange,
  shortCircuitFaultType,
  onShortCircuitFaultTypeChange,
  shortCircuitCurrentType,
  onShortCircuitCurrentTypeChange,
  shortCircuitFaultBusId,
  onShortCircuitFaultBusIdChange
}) {
  const isLoadFlow = studyType === 'loadflow';
  const isShortCircuit = studyType === 'shortcircuit';
  const isProtection = studyType === 'protection';

  const panelTitle = isLoadFlow
    ? 'Load Flow Settings'
    : isShortCircuit
      ? 'Short Circuit Settings'
      : 'Protection Coordination Settings';

  return (
    <section className="controls">
      <h3>{panelTitle}</h3>
      <p>Buses: {busCount}/20</p>
      <p>Selected: {selectedNodesCount} nodes, {selectedEdgesCount} connectors</p>
      <div className="buttons">
        {isLoadFlow && <button onClick={onRunLoadFlow}>Run Load Flow</button>}
        {isShortCircuit && <button onClick={onRunShortCircuit}>Run Short Circuit</button>}
        {isProtection && <button disabled>Run Protection Check (Soon)</button>}
      </div>

      {isShortCircuit && (
        <div className="editor">
          <h4>Short Circuit Setup</h4>
          <label>
            Calculation Standard
            <select
              value={shortCircuitStandard}
              onChange={(e) => onShortCircuitStandardChange(e.target.value)}
            >
              <option value="ansi">ANSI</option>
              <option value="iec_60909">IEC 60909</option>
            </select>
          </label>
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
              <option value="">
                {busNodes.length === 0 ? 'No buses available' : 'Select a bus'}
              </option>
              {busNodes.map((busNode) => (
                <option key={busNode.id} value={busNode.id}>
                  {busNode.data.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Current Required
            <select
              value={shortCircuitCurrentType}
              onChange={(e) => onShortCircuitCurrentTypeChange(e.target.value)}
            >
              <option value="initial_symmetrical">Initial symmetrical current</option>
              <option value="peak">Peak short-circuit current</option>
              <option value="thermal_equivalent">Thermal equivalent current</option>
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
                  step="0.01"
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
                Motor kV
                <input
                  type="number"
                  step="0.01"
                  value={selectedNode.data.kv}
                  onChange={(e) => onUpdateNode('kv', Number(e.target.value))}
                />
              </label>
              <label>
                Motor P (MW)
                <input
                  type="number"
                  step="0.01"
                  value={selectedNode.data.p_mw}
                  onChange={(e) => onUpdateNode('p_mw', Number(e.target.value))}
                />
              </label>
              <label>
                Motor pf
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  value={selectedNode.data.pf}
                  onChange={(e) => onUpdateNode('pf', Number(e.target.value))}
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
                  step="0.01"
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
                  step="0.01"
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
                MVAsc (MVA)
                <input
                  type="number"
                  step="0.01"
                  value={selectedNode.data.mvasc}
                  onChange={(e) => onUpdateNode('mvasc', Number(e.target.value))}
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
                  step="0.01"
                  value={selectedNode.data.hv_kv}
                  onChange={(e) => onUpdateNode('hv_kv', Number(e.target.value))}
                />
              </label>
              <label>
                LV (kV)
                <input
                  type="number"
                  step="0.01"
                  value={selectedNode.data.lv_kv}
                  onChange={(e) => onUpdateNode('lv_kv', Number(e.target.value))}
                />
              </label>
              <label>
                Rating (MVA)
                <input
                  type="number"
                  step="0.01"
                  value={selectedNode.data.mva_rating}
                  onChange={(e) => onUpdateNode('mva_rating', Number(e.target.value))}
                />
              </label>
              <label>
                %Z
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={selectedNode.data.z_percent ?? 6}
                  onChange={(e) => onUpdateNode('z_percent', Number(e.target.value))}
                />
              </label>
              <label>
                Vector Group
                <input
                  value={selectedNode.data.vector_group}
                  onChange={(e) => onUpdateNode('vector_group', e.target.value)}
                />
              </label>
              <label>
                X/R Ratio
                <input
                  type="number"
                  step="0.01"
                  value={selectedNode.data.xr_ratio}
                  onChange={(e) => onUpdateNode('xr_ratio', Number(e.target.value))}
                />
              </label>
            </>
          )}
        </div>
      )}

      {error && <pre className="error">{error}</pre>}
      {result &&
        (isShortCircuit ? (
          renderShortCircuitResults(result)
        ) : (
          <pre className="result">{JSON.stringify(result, null, 2)}</pre>
        ))}
    </section>
  );
}
