export default function ModelSelector({ model, setModel }){
  return (
    <div className="model-select">
      <span className="model-select__label small">Function / Model</span>
      <div className="model-select__control">
        <select
          className="model-select__input"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        >
          <option value="spike">Wheat Spike</option>
          <option value="uav_spike">UAV Spike</option>
          <option value="spikelet">Spikelet</option>
          <option value="fhb">FHB</option>
          <option value="fhb_field">FHB Field</option>
          <option value="fdk">FDK</option>
          <option value="kernel">Kernel Size</option>
          <option value="stomata">Stomata</option>
        </select>
      </div>
    </div>
  );
}
