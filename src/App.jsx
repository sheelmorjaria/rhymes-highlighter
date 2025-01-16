import { useState } from "react";
import React from "react";
import RhymesOutput from "./components/RhymesOutput";
import generateRhymes from "./util/rhymes";



function App() {
  const parser = new DOMParser();
  //input value
  const [searchCriteria, setSearchCriteria] = useState("");
  //output value
  const [lyrics, setLyrics] = useState([]);

  const[lyricsContent, setLyricsContent] = useState("");

  const [rhymesContent, setRhymesContent] = useState([]);

  const [selectedSong, setSelectedSong] = useState(null);

  const [finalRhymes, setFinalRhymes] = useState([]);

  const fetchLyrics = async () => {
    const url = `http://localhost:3001/api/lyrics?lyricText=${searchCriteria}`;

    try {
      if (searchCriteria === "") {
        throw new Error("Please enter a search criteria");
      }

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "text/xml",
        },
      });
      if (!response.ok) {
        throw new Error("Response status: " + response.status);
      }
      const data = await response.text();
      const xmlData = parser.parseFromString(data, "text/xml");

      const lyricsArray = [];
      const results = xmlData.querySelectorAll("SearchLyricResult");
      results.forEach((result) => {
        if (result === null) {
          return;
        }
        const lyricId = result.querySelector("LyricId")?.textContent || "N/A";
        const lyricChecksum =
          result.querySelector("LyricChecksum")?.textContent || "N/A";
        const artist = result.querySelector("Artist")?.textContent || "N/A";
        const song = result.querySelector("Song")?.textContent || "N/A";
        lyricsArray.push({ lyricId, lyricChecksum, artist, song });
      });
      console.log(lyricsArray);
      setLyrics(lyricsArray);
    } catch (error) {
      console.error(error);
    }
  };

  const fetchLyric = async (lyricId, lyricChecksum) => {
    const url = `http://localhost:3001/api/lyrics/${lyricId}/${lyricChecksum}`;

    try {
      if (!lyricId || !lyricChecksum) {
        throw new Error("Please enter a search criteria");
      }

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "text/xml",
        },
      });
      if (!response.ok) {
        throw new Error("Response status: " + response.status);
      }
      const data = await response.text();
      const xmlData = parser.parseFromString(data, "text/xml");
      const lyricsContent =
        xmlData.querySelector("Lyric")?.textContent || "N/A";
      console.log(lyricsContent);
      setLyricsContent(lyricsContent);

      // Fetch highlighted lyrics
      const highlightResponse = await fetch(
        "http://localhost:3001/api/highlight",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ lyrics: lyricsContent }),
        }
      );
      console.log(highlightResponse);
      if (!highlightResponse.ok) {
        throw new Error("Response status: " + highlightResponse.status);
      }

      const highlightedData = await highlightResponse.json();
      console.log(highlightedData);
      setRhymesContent(highlightedData);
      const output = generateRhymes(lyricsContent, highlightedData);
      console.log(output);
      setFinalRhymes(output);
      
      

      setSelectedSong(lyricId);
    } catch (error) {
      console.error(error);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    fetchLyrics();
  };


  return (
    <>
      <h1>Lyrics Search</h1>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={searchCriteria}
          onChange={(e) => setSearchCriteria(e.target.value)}
          placeholder="Search for lyrics"
        />
        <button type="submit">Search</button>
      </form>
      <ul>
        {lyrics &&
          lyrics.map((lyric, index) => (
            <li key={index}>
              <h2>{lyric.artist}</h2>
              <a
                href="#"
                onClick={() => fetchLyric(lyric.lyricId, lyric.lyricChecksum)}
              >
                {lyric.song}
              </a>
              {selectedSong === lyric.lyricId && (
                
                <RhymesOutput lyrics={lyricsContent} rhymes={rhymesContent} />
              )}
            </li>
          ))}
      </ul>
    </>
  );
}


export default App;
