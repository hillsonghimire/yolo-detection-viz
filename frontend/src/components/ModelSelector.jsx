export default function ModelSelector({ model, setModel }){
  return (
    <div className="model-select">
      <span className="model-select__label small">Task / Model</span>
      <div className="model-select__control">
        <select
          className="model-select__input"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        >
          <option value="spike">Wheat Spike</option>
          <option value="spikelet">Spikelet</option>
          <option value="fhb">FHB</option>
          <option value="fdk">FDK</option>
          <option value="kernel">Kernel Size)</option>
        </select>
      </div>
    </div>
  );
}
