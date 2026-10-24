import { useState } from "react";
import type { CSSProperties } from "react";
import { Power, RotateCcw, Save, Trash2 } from "lucide-react";
import { EQ_LABELS } from "../lib/audio";
import { BUILTIN_PRESETS } from "../lib/eq";
import { useEqStore } from "../store/eq";
import { useUiStore } from "../store/ui";
import { Modal } from "./Modal";

function formatDb(value: number): string {
  if (value === 0) return "0";
  return value > 0 ? `+${value}` : `${value}`;
}

export function EqualizerPanel() {
  const open = useUiStore((state) => state.equalizerOpen);
  const setOpen = useUiStore((state) => state.setEqualizerOpen);
  const enabled = useEqStore((state) => state.enabled);
  const bands = useEqStore((state) => state.bands);
  const preamp = useEqStore((state) => state.preamp);
  const presetId = useEqStore((state) => state.presetId);
  const customPresets = useEqStore((state) => state.customPresets);
  const setEnabled = useEqStore((state) => state.setEnabled);
  const setBand = useEqStore((state) => state.setBand);
  const setPreamp = useEqStore((state) => state.setPreamp);
  const applyPreset = useEqStore((state) => state.applyPreset);
  const savePreset = useEqStore((state) => state.savePreset);
  const deletePreset = useEqStore((state) => state.deletePreset);
  const reset = useEqStore((state) => state.reset);
  const [name, setName] = useState("");

  const allPresets = [...BUILTIN_PRESETS, ...customPresets];
  const activePreset = allPresets.find((preset) => preset.id === presetId);

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title="Эквалайзер"
      subtitle="10 полос · от 31 Гц до 16 кГц"
      size="lg"
    >
      <div className="eq-toolbar">
        <button
          className={`toggle-button${enabled ? " is-on" : ""}`}
          onClick={() => setEnabled(!enabled)}
        >
          <Power size={14} />
          {enabled ? "Включён" : "Выключен"}
        </button>
        <select
          className="select-input"
          value={presetId}
          onChange={(event) => {
            const preset = allPresets.find(
              (item) => item.id === event.target.value,
            );
            if (preset) applyPreset(preset);
          }}
        >
          {presetId === "custom" ? (
            <option value="custom">Свой набор</option>
          ) : null}
          {allPresets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
        </select>
        <button className="ghost-button" onClick={reset}>
          <RotateCcw size={14} />
          Сброс
        </button>
      </div>

      <div className={`eq-bands${enabled ? "" : " is-disabled"}`}>
        {bands.map((value, index) => (
          <label className="eq-band" key={EQ_LABELS[index]}>
            <span className="eq-value">{formatDb(value)}</span>
            <input
              className="eq-slider"
              type="range"
              min={-12}
              max={12}
              step={1}
              value={value}
              onChange={(event) => setBand(index, Number(event.target.value))}
              aria-label={`Полоса ${EQ_LABELS[index]} герц`}
            />
            <span className="eq-label">{EQ_LABELS[index]}</span>
          </label>
        ))}
      </div>

      <div className="eq-bottom">
        <div className="eq-preamp">
          <span>Предусиление</span>
          <input
            className="range"
            type="range"
            min={-12}
            max={12}
            step={1}
            value={preamp}
            onChange={(event) => setPreamp(Number(event.target.value))}
            style={
              {
                "--range-progress": `${((preamp + 12) / 24) * 100}%`,
              } as CSSProperties
            }
          />
          <strong>{formatDb(preamp)} дБ</strong>
        </div>

        <div className="eq-save">
          <input
            className="text-input"
            placeholder="Название своего пресета"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <button
            className="primary-button"
            onClick={() => {
              savePreset(name);
              setName("");
            }}
            disabled={!name.trim()}
          >
            <Save size={14} />
            Сохранить
          </button>
          {activePreset && !activePreset.builtin ? (
            <button
              className="ghost-button danger"
              onClick={() => deletePreset(activePreset.id)}
            >
              <Trash2 size={14} />
              Удалить
            </button>
          ) : null}
        </div>
      </div>
      <p className="modal-note">
        Пресеты хранятся локально. Эквалайзер применяется к текущему треку без
        перезапуска.
      </p>
    </Modal>
  );
}
