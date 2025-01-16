import React from "react";
import Word from "./Word";
import generateRhymes from "../util/rhymes";


const RhymesOutput = ({ lyrics, rhymes }) => {
  const lyricsWithRhymes = generateRhymes(lyrics, rhymes);
  console.log(lyricsWithRhymes);
  return (
    <div>
      {lyricsWithRhymes.map((line, i) => (
        <div key={i}>
          {line.map((word, j) => (
            <Word key={j} color={word.color} word={word.word} />
          ))}
        </div>
      ))}
    </div>
  );
}

 

export default RhymesOutput;
