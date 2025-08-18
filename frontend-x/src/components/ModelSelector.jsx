export default function ModelSelector({ model, setModel }){
  return (
    <div className="controls">
      <label className="small">Task / Model:</label>
      <select className="select" value={model} onChange={e=> setModel(e.target.value)}>
        <option value="spike">Wheat Spike</option>
        <option value="spikelet">Spikelet</option>
        <option value="third">Third Model</option>
      </select>
    </div>
  );
}
