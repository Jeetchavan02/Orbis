/**
 * Hand-built SVG interior illustrations for the homepage. One shared palette and drawing style
 * (flat shapes, soft floor shadow, warm woods, muted fabrics) so every card belongs to the same world.
 */
const P = {
  wall: "#f6f1ec", floor: "#ead9c4", floorLine: "#dcc6ab", shadow: "#000", wood: "#c98f5a", woodDark: "#9c6a3f",
  linen: "#f8f5ef", mauve: "#b98fb0", sage: "#8fae96", teal: "#5bb0a6", mustard: "#e8b54a", ink: "#3d3550",
  plant: "#4f8f5a", plantDark: "#3a7247", pot: "#d9c8b4", frame: "#4a3f5c", art1: "#f1b46b", art2: "#9b8be0", glass: "#cfe4f1",
};

function Floor() {
  return (
    <>
      <rect x="0" y="0" width="200" height="98" fill={P.wall} />
      <rect x="0" y="98" width="200" height="32" fill={P.floor} />
      {[20, 60, 100, 140, 180].map((x) => <line key={x} x1={x} y1="98" x2={x - 14} y2="130" stroke={P.floorLine} strokeWidth="1" />)}
    </>
  );
}
const Shadow = ({ cx, w }: { cx: number; w: number }) => <ellipse cx={cx} cy="111" rx={w / 2} ry="3.5" fill={P.shadow} opacity="0.08" />;
const Plant = ({ x, s = 1 }: { x: number; s?: number }) => (
  <g transform={`translate(${x} 110) scale(${s})`}>
    <ellipse cx="0" cy="1" rx="9" ry="2.5" fill="#000" opacity="0.08" />
    <path d="M-7 -14 L7 -14 L5 0 L-5 0 Z" fill={P.pot} />
    {[[-10, -32, -25], [9, -34, 25], [0, -42, 0], [-12, -22, -50], [12, -24, 50]].map(([dx, dy, rot], index) => (
      <ellipse key={index} cx={dx} cy={dy} rx="5.5" ry="11" fill={index % 2 ? P.plantDark : P.plant} transform={`rotate(${rot} ${dx} ${dy})`} />
    ))}
  </g>
);
const Art = ({ x, y, w = 26, h = 20 }: { x: number; y: number; w?: number; h?: number }) => (
  <g>
    <rect x={x} y={y} width={w} height={h} rx="1.5" fill="#fff" stroke={P.frame} strokeWidth="2" />
    <circle cx={x + w * 0.62} cy={y + h * 0.4} r={h * 0.18} fill={P.art1} />
    <path d={`M${x + 3} ${y + h - 3} L${x + w * 0.4} ${y + h * 0.45} L${x + w - 3} ${y + h - 3} Z`} fill={P.art2} />
  </g>
);
const Lamp = ({ x, y, glow = true }: { x: number; y: number; glow?: boolean }) => (
  <g>
    {glow ? <circle cx={x} cy={y + 4} r="11" fill="#ffd98a" opacity="0.25" /> : null}
    <path d={`M${x - 6} ${y} L${x + 6} ${y} L${x + 8} ${y + 8} L${x - 8} ${y + 8} Z`} fill="#f3dfb4" />
    <rect x={x - 1} y={y + 8} width="2" height="8" fill={P.ink} />
    <rect x={x - 4} y={y + 15} width="8" height="2" rx="1" fill={P.ink} />
  </g>
);

export function BedroomArt() {
  return (
    <svg viewBox="0 0 200 130" preserveAspectRatio="xMidYMid slice" className="illustration" aria-hidden="true">
      <Floor />
      <Art x={87} y={20} />
      <Shadow cx={100} w={96} />
      <rect x="58" y="52" width="84" height="40" rx="5" fill={P.wood} />
      <rect x="54" y="78" width="92" height="22" rx="4" fill={P.woodDark} />
      <rect x="57" y="72" width="86" height="16" rx="5" fill={P.linen} />
      <rect x="66" y="64" width="30" height="12" rx="5" fill="#fff" />
      <rect x="104" y="64" width="30" height="12" rx="5" fill="#fff" />
      <path d="M57 82 Q100 76 143 82 L143 92 L57 92 Z" fill={P.mauve} />
      <rect x="57" y="92" width="86" height="5" fill="#a57c9c" />
      {[[30, 58], [170, 58]].map(([x]) => (
        <g key={x}>
          <Shadow cx={x!} w={30} />
          <rect x={x! - 13} y="80" width="26" height="28" rx="2" fill={P.wood} />
          <rect x={x! - 11} y="84" width="22" height="9" rx="1" fill="#d9a46f" />
          <rect x={x! - 11} y="95" width="22" height="9" rx="1" fill="#d9a46f" />
          <rect x={x! - 3} y="88" width="6" height="1.5" fill={P.woodDark} /><rect x={x! - 3} y="99" width="6" height="1.5" fill={P.woodDark} />
          <Lamp x={x!} y={62} />
        </g>
      ))}
    </svg>
  );
}

export function LivingArt() {
  return (
    <svg viewBox="0 0 200 130" preserveAspectRatio="xMidYMid slice" className="illustration" aria-hidden="true">
      <Floor />
      <Art x={70} y={18} w={30} h={22} />
      <Art x={106} y={22} w={20} h={16} />
      <Shadow cx={90} w={110} />
      <rect x="38" y="60" width="104" height="26" rx="8" fill={P.teal} />
      <rect x="32" y="70" width="14" height="32" rx="6" fill="#4d9d93" />
      <rect x="134" y="70" width="14" height="32" rx="6" fill="#4d9d93" />
      <rect x="44" y="80" width="92" height="18" rx="5" fill="#69bdb3" />
      <line x1="90" y1="81" x2="90" y2="97" stroke="#4d9d93" strokeWidth="1.5" />
      <rect x="40" y="100" width="3" height="8" fill={P.woodDark} /><rect x="137" y="100" width="3" height="8" fill={P.woodDark} />
      <Shadow cx={92} w={50} />
      <ellipse cx="92" cy="104" rx="24" ry="5" fill={P.wood} />
      <rect x="90" y="104" width="4" height="7" fill={P.woodDark} />
      <ellipse cx="92" cy="110" rx="12" ry="2" fill={P.woodDark} />
      <rect x="64" y="72" width="12" height="10" rx="3" fill={P.mustard} />
      <Plant x={170} s={1.2} />
    </svg>
  );
}

export function DiningArt() {
  return (
    <svg viewBox="0 0 200 130" preserveAspectRatio="xMidYMid slice" className="illustration" aria-hidden="true">
      <Floor />
      <line x1="100" y1="0" x2="100" y2="24" stroke={P.ink} strokeWidth="1.2" />
      <circle cx="100" cy="34" r="16" fill="#ffd98a" opacity="0.25" />
      <path d="M88 32 Q100 18 112 32 Z" fill={P.mustard} />
      <Shadow cx={100} w={100} />
      <ellipse cx="100" cy="82" rx="42" ry="7" fill={P.wood} />
      <rect x="97" y="84" width="6" height="22" fill={P.woodDark} />
      <ellipse cx="100" cy="107" rx="14" ry="2.5" fill={P.woodDark} />
      <circle cx="100" cy="76" r="4" fill={P.plant} /><rect x="98" y="77" width="4" height="4" fill={P.pot} />
      {[[52, 1], [148, -1], [74, 1], [126, -1]].map(([x, dir], index) => (
        <g key={index} opacity={index > 1 ? 1 : 0.95}>
          <rect x={x! - 9} y={index > 1 ? 80 : 74} width="18" height="5" rx="2" fill={P.mustard} />
          <rect x={dir! > 0 ? x! - 9 : x! + 6} y={index > 1 ? 58 : 52} width="3" height="24" rx="1.5" fill={P.mustard} />
          <rect x={x! - 7} y={index > 1 ? 85 : 79} width="2" height="22" fill={P.woodDark} /><rect x={x! + 5} y={index > 1 ? 85 : 79} width="2" height="22" fill={P.woodDark} />
        </g>
      ))}
      <Plant x={176} s={0.9} />
    </svg>
  );
}

export function KitchenArt() {
  return (
    <svg viewBox="0 0 200 130" preserveAspectRatio="xMidYMid slice" className="illustration" aria-hidden="true">
      <Floor />
      <rect x="30" y="16" width="140" height="22" rx="2" fill={P.teal} />
      {[30, 65, 100, 135].map((x) => <g key={x}><rect x={x + 2} y="18" width="31" height="18" rx="1.5" fill="#69bdb3" /><rect x={x + 15} y="32" width="6" height="1.5" fill="#3f8a81" /></g>)}
      <rect x="40" y="52" width="10" height="14" rx="1" fill={P.wall} stroke="#d6cfc4" />
      <Shadow cx={100} w={150} />
      <rect x="24" y="68" width="152" height="5" rx="1" fill="#e7e1d6" />
      <rect x="26" y="73" width="148" height="34" rx="2" fill="#e8c99d" />
      {[26, 63, 100, 137].map((x) => <g key={x}><rect x={x + 2} y="76" width="33" height="28" rx="1.5" fill="#f0d8b2" /><rect x={x + 15} y="80" width="7" height="1.5" fill={P.woodDark} /></g>)}
      <rect x="100" y="76" width="35" height="28" rx="1.5" fill="#3f3a48" />
      <rect x="104" y="81" width="27" height="12" rx="1" fill="#2a2632" />
      {[106, 116, 126].map((x) => <circle key={x} cx={x + 2} cy="70" r="2.5" fill="#3f3a48" />)}
      <path d="M58 66 Q58 56 66 56" fill="none" stroke="#8d97a3" strokeWidth="2" />
      <rect x="146" y="58" width="6" height="10" fill={P.pot} /><circle cx="149" cy="54" r="5" fill={P.plant} />
      <rect x="160" y="60" width="9" height="8" rx="1" fill={P.mustard} />
    </svg>
  );
}

export function OfficeArt() {
  return (
    <svg viewBox="0 0 200 130" preserveAspectRatio="xMidYMid slice" className="illustration" aria-hidden="true">
      <Floor />
      <rect x="128" y="22" width="44" height="3" fill={P.woodDark} />
      {[0, 6, 11, 17].map((x, i) => <rect key={x} x={132 + x} y={10 - (i % 2) * 2} width="4.5" height={12 + (i % 2) * 2} fill={[P.mauve, P.mustard, P.teal, P.art2][i]} />)}
      <circle cx="162" cy="16" r="5" fill={P.plant} /><rect x="159" y="18" width="6" height="4" fill={P.pot} />
      <Shadow cx={98} w={110} />
      <rect x="40" y="72" width="116" height="5" rx="1.5" fill={P.wood} />
      <rect x="44" y="77" width="4" height="30" fill={P.woodDark} />
      <rect x="120" y="77" width="32" height="30" rx="1.5" fill="#d9a46f" />
      <rect x="132" y="84" width="8" height="1.5" fill={P.woodDark} /><rect x="132" y="96" width="8" height="1.5" fill={P.woodDark} />
      <rect x="72" y="40" width="44" height="28" rx="2" fill="#3a3550" />
      <rect x="75" y="43" width="38" height="22" rx="1" fill="#8e9ef0" />
      <path d="M84 60 L94 50 L104 60 Z" fill="#c9d1fa" />
      <rect x="92" y="68" width="4" height="4" fill="#3a3550" /><rect x="86" y="71" width="16" height="2" rx="1" fill="#3a3550" />
      <Shadow cx={86} w={30} />
      <rect x="74" y="78" width="24" height="7" rx="3" fill={P.mauve} />
      <rect x="76" y="56" width="20" height="22" rx="5" fill="#a57c9c" />
      <rect x="85" y="85" width="2.5" height="18" fill={P.ink} />
      <path d="M74 106 L98 106" stroke={P.ink} strokeWidth="2.5" strokeLinecap="round" />
      <Plant x={26} s={1.05} />
    </svg>
  );
}

export function BlankRoomArt() {
  return (
    <svg viewBox="0 0 200 120" className="illustration" aria-hidden="true">
      <path d="M100 98 L176 62 L100 30 L24 62 Z" fill="#efe8de" />
      <path d="M24 62 L24 22 L100 -8 L100 30 Z" fill="#fbf9f6" stroke="#e3dbd0" />
      <path d="M100 30 L100 -8 L176 22 L176 62 Z" fill="#f2ede6" stroke="#e3dbd0" />
      <path d="M128 22 L156 34 L156 54 L128 42 Z" fill={P.glass} stroke="#b9cfe0" strokeWidth="1.5" />
      <line x1="142" y1="28" x2="142" y2="48" stroke="#b9cfe0" strokeWidth="1.2" />
      <path d="M100 98 L176 62 L176 66 L100 102 Z" fill="#d9cdbd" />
      <path d="M100 98 L24 62 L24 66 L100 102 Z" fill="#e3d8ca" />
    </svg>
  );
}

export function HeroArt() {
  return (
    <svg viewBox="0 0 520 250" className="illustration hero-art" aria-hidden="true">
      <path d="M40 210 Q60 40 260 30 Q470 20 500 150 Q510 230 430 236 L60 236 Z" fill="#efe9fe" />
      <rect x="40" y="226" width="460" height="10" rx="5" fill="#e3dafb" />
      <path d="M118 62 Q118 34 150 30 L188 30" fill="none" stroke={P.ink} strokeWidth="4" />
      <path d="M170 34 L206 34 L216 56 L160 56 Z" fill="#6a3de8" />
      <ellipse cx="188" cy="62" rx="22" ry="6" fill="#ffd98a" opacity="0.6" />
      <rect x="116" y="62" width="4" height="150" fill={P.ink} /><rect x="104" y="208" width="28" height="5" rx="2" fill={P.ink} />
      <rect x="230" y="40" width="54" height="64" rx="3" fill="#fff" stroke={P.frame} strokeWidth="4" />
      <circle cx="262" cy="64" r="11" fill={P.art1} /><path d="M236 98 L258 72 L280 98 Z" fill={P.art2} />
      <path d="M150 230 L150 160 Q150 120 200 124 L250 124 Q282 124 284 160 L284 230 Z" fill="#7c5ae6" />
      <rect x="140" y="170" width="160" height="50" rx="16" fill="#8b6cf0" />
      <rect x="196" y="150" width="54" height="36" rx="10" fill={P.mustard} transform="rotate(-8 223 168)" />
      <g transform="translate(86 230)">
        <path d="M-16 -36 L16 -36 L12 0 L-12 0 Z" fill="#c8b9a6" />
        {[[-22, -78, -30], [20, -82, 30], [0, -98, 0], [-26, -56, -55], [26, -58, 55]].map(([dx, dy, rot], index) => (
          <ellipse key={index} cx={dx} cy={dy} rx="13" ry="26" fill={index % 2 ? P.plantDark : P.plant} transform={`rotate(${rot} ${dx} ${dy})`} />
        ))}
      </g>
      <rect x="314" y="190" width="190" height="10" rx="3" fill={P.wood} />
      <rect x="326" y="200" width="8" height="30" fill={P.woodDark} /><rect x="484" y="200" width="8" height="30" fill={P.woodDark} />
      <rect x="334" y="62" width="150" height="104" rx="8" fill="#3a3550" />
      <rect x="342" y="70" width="134" height="86" rx="4" fill="#dfe6fb" />
      {[0, 1, 2, 3, 4].map((i) => <circle key={i} cx="352" cy={82 + i * 15} r="3" fill="#8e9ef0" />)}
      <g transform="translate(418 116)">
        <path d="M0 26 L38 8 L0 -10 L-38 8 Z" fill="#efe3d3" />
        <path d="M-38 8 L-38 -20 L0 -38 L0 -10 Z" fill="#fff" stroke="#d3c9e8" />
        <path d="M0 -10 L0 -38 L38 -20 L38 8 Z" fill="#f4f0fb" stroke="#d3c9e8" />
        <rect x="-22" y="-2" width="20" height="10" rx="2" fill="#a57c9c" transform="skewY(-25)" />
        <rect x="14" y="-6" width="12" height="16" rx="1.5" fill={P.mustard} />
      </g>
      <rect x="398" y="166" width="22" height="24" fill="#3a3550" /><rect x="380" y="186" width="58" height="5" rx="2" fill="#3a3550" />
      <rect x="456" y="172" width="34" height="8" rx="2" fill="#6a3de8" /><rect x="460" y="164" width="26" height="8" rx="2" fill={P.mustard} />
    </svg>
  );
}

export const ROOM_ART = { bedroom: BedroomArt, living: LivingArt, dining: DiningArt, kitchen: KitchenArt, office: OfficeArt };
