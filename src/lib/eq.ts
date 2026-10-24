export interface EqPreset {
  id: string;
  name: string;
  bands: number[];
  preamp: number;
  builtin?: boolean;
}

export const BUILTIN_PRESETS: EqPreset[] = [
  {
    id: "flat",
    name: "Ровный",
    bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    preamp: 0,
    builtin: true,
  },
  {
    id: "bass",
    name: "Бас",
    bands: [7, 6, 4, 2, 0, 0, 0, 0, 0, 0],
    preamp: -2,
    builtin: true,
  },
  {
    id: "vocal",
    name: "Вокал",
    bands: [-2, -1, 0, 2, 4, 4, 2, 0, -1, -2],
    preamp: -1,
    builtin: true,
  },
  {
    id: "rock",
    name: "Рок",
    bands: [5, 4, 2, -1, -2, 0, 2, 4, 5, 5],
    preamp: -2,
    builtin: true,
  },
  {
    id: "pop",
    name: "Поп",
    bands: [-1, 0, 2, 3, 2, 0, -1, -1, 0, 1],
    preamp: -1,
    builtin: true,
  },
  {
    id: "classical",
    name: "Классика",
    bands: [3, 2, 1, 0, 0, 0, -1, -2, -2, -3],
    preamp: 0,
    builtin: true,
  },
  {
    id: "night",
    name: "Ночь",
    bands: [-3, -2, 0, 2, 3, 2, 0, -2, -4, -5],
    preamp: 1,
    builtin: true,
  },
  {
    id: "warm",
    name: "Тёплый ламповый",
    bands: [3, 2, 1, 0, -1, -1, 0, 1, 2, 3],
    preamp: -1,
    builtin: true,
  },
];
