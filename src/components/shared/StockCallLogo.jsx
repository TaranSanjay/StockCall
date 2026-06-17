export default function StockCallLogo({ height = 40 }) {
  const aspectRatio = 180 / 56;
  const width = height * aspectRatio;

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 180 56"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Stock Call"
      style={{ display: 'block' }}
    >
      <title>Stock Call</title>
      <rect
        x="0" y="2" width="44" height="44" rx="2"
        fill="none" stroke="#111111" strokeWidth="2"
      />
      <text
        x="22" y="33"
        fontFamily="Georgia, 'Times New Roman', serif"
        fontSize="22" fontWeight="700"
        fill="#111111" textAnchor="middle"
      >
        SC
      </text>
      <text
        x="56" y="22"
        fontFamily="Georgia, 'Times New Roman', serif"
        fontSize="14" fontWeight="700"
        fill="#111111" letterSpacing="1.5"
      >
        STOCK
      </text>
      <line
        x1="56" y1="29" x2="176" y2="29"
        stroke="#AAAAAA" strokeWidth="0.8"
      />
      <text
        x="56" y="44"
        fontFamily="Georgia, 'Times New Roman', serif"
        fontSize="14" fontWeight="700"
        fill="#111111" letterSpacing="1.5"
      >
        CALL
      </text>
    </svg>
  );
}
