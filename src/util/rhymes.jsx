const COLORS = [
  "#00FFFF", // aqua
  "#7FFFD4", // aquamarine
  "#0000FF", // blue
  "#8A2BE2", // blueviolet
  "#5F9EA0", // cadetblue
  "#7FFF00", // chartreuse
  "#FF7F50", // coral
  "#6495ED", // cornflowerblue
  "#DC143C", // crimson
  "#FF8C00", // darkorange
  "#FF00FF", // fuchsia
  "#FFD700", // gold
  "#DAA520", // goldenrod
  "#008000", // green
  "#ADFF2F", // greenyellow
  "#FF69B4", // hotpink
  "#CD5C5C", // indianred
  "#4B0082", // indigo
  "#FFFFF0", // ivory
  "#F0E68C", // khaki
  "#E6E6FA", // lavender
  "#FFF0F5", // lavenderblush
  "#7CFC00", // lawngreen
  "#FFFACD", // lemonchiffon
  "#ADD8E6", // lightblue
  "#F08080", // lightcoral
  "#E0FFFF", // lightcyan
  "#FAFAD2", // lightgoldenrodyellow
  "#D3D3D3", // lightgray
  "#90EE90", // lightgreen
  "#FFB6C1", // lightpink
  "#FFA07A", // lightsalmon
  "#20B2AA", // lightseagreen
  "#87CEFA", // lightskyblue
  "#778899", // lightslategray
  "#B0C4DE", // lightsteelblue
  "#FFFFE0", // lightyellow
  "#00FF00", // lime
  "#32CD32", // limegreen
  "#FAF0E6", // linen
  "#800000", // maroon
  "#66CDAA", // mediumaquamarine
  "#0000CD", // mediumblue
  "#BA55D3", // mediumorchid
  "#9370DB", // mediumpurple
  "#3CB371", // mediumseagreen
  "#7B68EE", // mediumslateblue
  "#00FA9A", // mediumspringgreen
  "#48D1CC", // mediumturquoise
  "#C71585", // mediumvioletred
  "#191970", // midnightblue
  "#F5FFFA", // mintcream
  "#FFE4E1", // mistyrose
  "#FFE4B5", // moccasin
  "#FFDEAD", // navajowhite
  "#000080", // navy
  "#FDF5E6", // oldlace
  "#808000", // olive
  "#6B8E23", // olivedrab
  "#FFA500", // orange
  "#FF4500", // orangered
  "#DA70D6", // orchid
  "#EEE8AA", // palegoldenrod
  "#98FB98", // palegreen
  "#AFEEEE", // paleturquoise
  "#DB7093", // palevioletred
  "#FFEFD5", // papayawhip
  "#FFDAB9", // peachpuff
  "#CD853F", // peru
  "#FFC0CB", // pink
  "#DDA0DD", // plum
  "#B0E0E6", // powderblue
  "#800080", // purple
  "#FF0000", // red
  "#BC8F8F", // rosybrown
  "#4169E1", // royalblue
  "#8B4513", // saddlebrown
  "#FA8072", // salmon
  "#F4A460", // sandybrown
  "#2E8B57", // seagreen
  "#FFF5EE", // seashell
  "#A0522D", // sienna
  "#C0C0C0", // silver
  "#87CEEB", // skyblue
  "#6A5ACD", // slateblue
  "#708090", // slategray
  "#FFFAFA", // snow
  "#00FF7F", // springgreen
  "#4682B4", // steelblue
  "#D2B48C", // tan
  "#008080", // teal
  "#D8BFD8", // thistle
  "#FF6347", // tomato
  "#40E0D0", // turquoise
  "#EE82EE", // violet
  "#F5DEB3", // wheat
  "#FFFFFF", // white
  "#F5F5F5", // whitesmoke
  "#FFFF00", // yellow
  "#9ACD32", // yellowgreen
];

// shuffle array in place

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    let j = Math.floor(Math.random() * (i + 1));
    let x = array[i];
    array[i] = array[j];
    array[j] = x;
  }
  return array;
}

function getWordData(parsedWord, word, colors) {
  for (let [color, rhymeCluster] of Object.entries(colors)) {
    if (rhymeCluster.includes(parsedWord)) {
      return { color, word };
    }
  }

  return { color: "white", word };
}

const generateRhymes = (lyrics, rhymes)=> {
  const colors = shuffleArray(COLORS);

  if (!lyrics) {
    return [];
  }
  
  const wordData = [];
  const words = lyrics.replace(/  +/g, " y").split(/\n| /);
  const parsedWords = lyrics
    .toLowerCase()
    .replace(/[.,:?!;\-()']/g, "")
    .replace(/  +/g, " ")
    .split("\n")
    .map((arr) => arr.split(" "));

  let colorIndex = 0;
  let colorMap = rhymes.reduce((map, rhymeCluster) => {
    map[colors[colorIndex]] = rhymeCluster;
    colorIndex++;
    return map;
  }, {});

  let counter = 0;

  for (let line of parsedWords) {
    let arr = line;
    let lineData = [];

    for (let i = 0; i < arr.length; i++) {
      let parsedWord = arr[i];
      let word = words[counter];

      lineData.push(getWordData(parsedWord, word, colorMap));
      counter++;
    }
    wordData.push(lineData);
  }

  return wordData;
};

export default generateRhymes;
