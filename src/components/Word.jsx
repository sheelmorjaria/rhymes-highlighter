import React from "react";

const Word = ({ color = "white", word }) => {
  return (
    <>
    <span
      style={{
        backgroundColor: color,
      }}
    >
      {word}
    </span>
    <span> </span>
    </>
   
  );
};

export default Word;
