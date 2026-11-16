export type Mover = {
  command: string;
  name: string;
  visit: string;
};

export type MoverPoint = {
  date: string;
  ra: number;
  dec: number;
  earth_km: number;
  closing_km_s: number;
};

export type MoverPath = {
  command: string;
  step_days: number;
  points: MoverPoint[];
  travelled_deg: number;
  per_day_deg: number;
};

export type SkyPath = {
  name: string;
  points: { ra: number; dec: number; date: string }[];
  active: number;
};

export const MOVERS: Mover[] = [
  { command: "433;", name: "Eros", visit: "NEAR Shoemaker touched down on it in 2001." },
  { command: "101955;", name: "Bennu", visit: "OSIRIS-REx brought a sample of it to Earth in 2023." },
  { command: "162173;", name: "Ryugu", visit: "Hayabusa2 returned grains from it in 2020." },
  { command: "25143;", name: "Itokawa", visit: "Hayabusa returned the first asteroid dust in 2010." },
  { command: "65803;", name: "Didymos", visit: "DART struck its moonlet Dimorphos in 2022 and shortened its orbit." },
  { command: "99942;", name: "Apophis", visit: "Passes about 32,000 km above Earth on 13 April 2029." },
  { command: "1;", name: "Ceres", visit: "Dawn orbited this dwarf planet from 2015 to 2018." },
  { command: "4;", name: "Vesta", visit: "Dawn mapped it from orbit in 2011 and 2012." },
  { command: "16;", name: "Psyche", visit: "A metal-rich world. NASA's Psyche spacecraft arrives in 2029." },
  { command: "3200;", name: "Phaethon", visit: "The parent body of the Geminid meteor shower." },
  { command: "52246;", name: "Donaldjohanson", visit: "Lucy flew past it in April 2025." },
  { command: "152830;", name: "Dinkinesh", visit: "Lucy found a two-lobed moon around it in 2023." },
];

export const SPANS = [7, 30, 90] as const;

export function formatKm(km: number) {
  if (km >= 1e6) return `${(km / 1e6).toFixed(1)} million km`;
  return `${Math.round(km).toLocaleString("en-US")} km`;
}

export function formatAngle(degrees: number) {
  if (degrees >= 1) return `${degrees.toFixed(2)}°`;
  if (degrees * 60 >= 1) return `${(degrees * 60).toFixed(1)} arcmin`;
  return `${(degrees * 3600).toFixed(0)} arcsec`;
}

export function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}
