import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import bodyParser from "body-parser";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

class Song {
  constructor(lyrics) {
    this.lyrics = lyrics;
    const replaceAllPunc = this.lyrics.replace(/[.,:?!;\-()']/g, "");
    this.lyricsArray = replaceAllPunc.split(/ |\n/);
  }

  async init() {
    try {
      this.rhymes = await this.generateRhymes(this.lyricsArray);
    } catch (error) {
      console.error("Error generating rhymes:", error);
      this.rhymes = {};
    }
  }

  async generateRhymes(stringArr) {
    const res = {};

    for (const string of stringArr) {
      const lowerString = string.toLowerCase();

      if (!res[lowerString]) {
        try {
          const datamuseURL = `https://api.datamuse.com/words?rel_rhy=${lowerString}`;
          const response = await fetch(datamuseURL);
          const rhymes = await response.json();

          res[lowerString] = Array.isArray(rhymes) ? rhymes.map((rhyme) => rhyme.word) : [];
          console.log(res[lowerString]);
        } catch (error) {
          console.error(error);
          res[lowerString] = [];
        }
      }
    }
    return res;
  }
  //checks if two words rhyme with each other
  async rhyme(word1, word2) {
    if (!this.rhymes) {
      await this.init();
    }

    const lowerWord1 = word1.toLowerCase();
    const lowerWord2 = word2.toLowerCase();

    if (lowerWord1 === lowerWord2) {
      return true;
    }

    //if the word is not in the rhymes object, it is not a rhyme
    if (!this.rhymes[lowerWord1] || !this.rhymes[lowerWord2]) {
      return false;
    }

    //if the word is in the rhymes object, it is a rhyme
   if(this.rhymes[lowerWord1].includes(lowerWord2)){

    return true;
   }
   if(this.rhymes[lowerWord2].includes(lowerWord1)){
      return true;
    }

    

    //if the word is not in the rhymes object, it is not a rhyme
    return false;
  }
  //removes all lists of single words
  removeAllSingleWords(clusters) {
    const removed_clusters = [];
    for (const cluster of clusters) {
      if (cluster.length > 1) {
        removed_clusters.push(cluster);
      }
    }
    return removed_clusters;
  }

  async checkCluster(word, clusters) {
    if (clusters.length < 1) {
      clusters.push([word]);
      return clusters;
    }

    for (const cluster of clusters) {
      if (await this.rhyme(word, cluster[0])) {
        cluster.push(word);
        return clusters;
      }
    }
    clusters.push([word]);
    return clusters;
  }

  async findClusters() {
    const clusters = [];
    for (const word of this.lyricsArray) {
      await this.checkCluster(word, clusters);
    }
    return this.removeAllSingleWords(clusters);
  }
}

app.post("/api/highlight", async (req, res) => {
  try {
    const { lyrics } = req.body;
    const song = new Song(lyrics);
    await song.init();
    const clusters = await song.findClusters();
    res.send(clusters);
  } catch (error) {
    console.error("Error processing /api/highlight request:", error);
    res.status(500).send("Internal Server Error");
  }
});

app.get("/api/lyrics", async (req, res) => {
  const { lyricText } = req.query;
  const url = `http://api.chartlyrics.com/apiv1.asmx/SearchLyricText?lyricText=${lyricText}`;

  try {
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
    res.send(data);
  } catch (error) {
    res.status(500).send(error.toString());
  }
});

app.get("/api/lyrics/:lyricId/:lyricCheckSum", async (req, res) => {
  const { lyricId, lyricCheckSum } = req.params;
  const url = `http://api.chartlyrics.com/apiv1.asmx/GetLyric?lyricId=${lyricId}&lyricCheckSum=${lyricCheckSum}`;

  try {
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

    res.send(data);
  } catch (error) {
    res.status(500).send(error.toString());
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${port}`);
});

module.exports = app;