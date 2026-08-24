# Direct Democracy – tulosten eheystodisteet

Tämä repo ei sisällä sovelluksen lähdekoodia - se löytyy erikseen osoitteesta
[github.com/aksu11/directDemocracyServer](https://github.com/aksu11/directDemocracyServer).
Tämä repo on sen sijaan **automaattinen, ulkopuolinen todiste** siitä, ettei
Direct Democracy -sovelluksen äänestystuloksia ole muokattu jälkikäteen sen
jälkeen kun ne on tänne kirjattu.

## Miksi tämä on olemassa

Äänet tallennetaan Google Firestoreen, jota sovelluksen ylläpitäjä hallinnoi.
Periaatteessa ylläpitäjä voisi teknisesti muokata tuloksia suoraan
tietokannassa. Tätä repoa ei voi käyttää sen *estämiseen* — mutta sitä
käytetään tekemään sellainen muokkaus **havaittavaksi**. Sama rajoitus
koskisi mitä tahansa keskitetysti ylläpidettyä äänestysjärjestelmää, myös
lohkoketjupohjaista, jos yksi taho on se joka kirjoittaa dataa ketjuun (ns.
"oracle-ongelma").

## Miten se toimii

1. Jokainen ääni ja jokaisen äänestyksen sulkeutuminen kirjataan sovelluksen
   tietokantaan **hash-ketjuna**: jokainen tapahtuma sisältää tiivisteen
   (hash) edellisestä tapahtumasta. Jos yksikin historiallinen tapahtuma
   muutettaisiin jälkikäteen, kaikki sitä seuraavat tiivisteet muuttuisivat
   havaittavasti.
2. Kerran vuorokaudessa sovelluksen palvelin laskee jokaisen äänestyksen
   senhetkisen ketjun pään tiivisteen ja committaa sen tähän repoon,
   kansioon `anchors/`.
3. Tämä repo on julkinen, eikä sen commit-historiaa voi muokata jälkikäteen
   ilman että se näkyisi — kuka tahansa voi kloonata tai forkata repon
   milloin tahansa ottaakseen oman kopionsa historiasta. Aiemmin committoitu
   tiiviste toimii siis ulkopuolisena, ajastettuna todisteena: jos
   sovelluksen tietokannassa oleva tulos ei enää täsmää tähän aiemmin
   julkaistuun tiivisteeseen, joku on muokannut sitä julkaisun jälkeen.

## Mitä tämä TODISTAA ja mitä EI

✅ **Todistaa:** äänestyksen tulosta ei ole muokattu sen jälkeen kun sen
tiiviste on committoitu tähän repoon.

✅ **Todistaa (koodin osalta):** koska palvelimen lähdekoodi
([directDemocracyServer](https://github.com/aksu11/directDemocracyServer))
on julkinen, kuka tahansa voi lukea juuri sen logiikan joka laskee äänet ja
rakentaa hash-ketjun - ei tarvitse luottaa pelkkään väitteeseen siitä miten
laskenta toimii.

❌ **Ei todista:** että *juuri tällä hetkellä tuotannossa ajettava* versio
palvelimesta on sama kuin julkisessa repossa (voit tarkistaa tämän
vertaamalla `directDemocracyServer`-repon commit-historiaa palvelimen
`/health`-reitin palauttamaan `gitCommit`-kenttään), tai ettei
tietokantaa olisi voitu muokata suoraan Firestoren kautta, ohi
sovelluslogiikan kokonaan - lähdekoodin julkisuus ei estä tätä, koska
sillä joka hallinnoi tietokannan pääsyoikeuksia on aina tekninen
mahdollisuus ohittaa oma sovelluksensa. Tämä on tunnettu rajoitus
(oracle-ongelma) kaikissa keskitetysti ylläpidetyissä
äänestysjärjestelmissä - myös lohkoketjupohjaisissa, jos yksi taho on se
joka kirjoittaa dataa ketjuun.

## `anchors/`-tiedostojen sisältö

Jokainen `anchors/VVVV-KK-PP.json` sisältää sen hetken tilan jokaiselle
äänestykselle:

```json
{
  "generatedAt": "2026-08-24T12:00:00.000Z",
  "rootHash": "…",
  "polls": [
    {
      "pollId": "perustuslakituomioistuin-2026-07",
      "question": "Pitäisikö Suomeen perustaa perustuslakituomioistuin?",
      "status": "ended",
      "closedAt": "2026-07-03T10:20:00.000Z",
      "chainHead": "a3f9e21b7c4d8e2f1a9b6c3d5e7f8a1b2c4d6e8f9a1b3c5d7e9f0a2b4c6d8e0f",
      "sequenceLength": 128
    }
  ]
}
```

- `chainHead` on äänestyksen hash-ketjun senhetkisen viimeisen tapahtuman
  tiiviste (SHA-256, heksana). Se **ei paljasta äänimääriä tai
  prosentteja** niin kauan kuin äänestys on avoinna — vasta äänestyksen
  sulkeuduttua sovelluksen julkinen API paljastaa varsinaisen tuloksen,
  jota vastaan tätä tiivistettä voi verrata.
- `rootHash` on yksi yhdistetty tiiviste kaikista saman päivän
  `polls`-listan `chainHead`-arvoista, jotta koko päivän tilan voi
  tarkistaa yhdellä silmäyksellä ilman että pitää vertailla jokaista riviä
  erikseen.
- `sequenceLength` on ketjussa olevien tapahtumien (äänten + genesis- ja
  sulkeutumismerkinnän) lukumäärä.

## Miten tarkistat itse ettei tuloksia ole muokattu

Tässä repossa on [`verify.js`](./verify.js), joka ei luota mihinkään
valmiiksi — se hakee päättyneen äänestyksen koko historian sovelluksen
julkisesta rajapinnasta ja laskee tiivisteet **uudelleen itse**:

```
node verify.js <pollId>
```

(`pollId` löytyy tämän repon `anchors/`-tiedostoista tai suoraan sovelluksen
API:sta osoitteesta `https://directdemocracy-4yjp.onrender.com/api/polls/ended`.)

Skripti tarkistaa:

1. että jokainen tapahtuma ketjussa täsmää omasta sisällöstään laskettuun
   tiivisteeseen,
2. että ketju ei ole katkennut (yhtään tapahtumaa ei ole poistettu tai
   lisätty väliin),
3. että ketjun viimeinen tiiviste täsmää sovelluksen julkisesti näyttämään
   `chainHead`-arvoon, ja
4. että julkaistut prosenttiosuudet täsmäävät ketjuun lukittuihin
   äänimääriin.

Voit lisäksi itse verrata `verify.js`:n tulostamaa `chainHead`-arvoa tämän
repon `anchors/`-kansion aiemmin julkaistuihin arvoihin samalle
äänestykselle: jos ne täsmäävät joka päivä äänestyksen sulkeutumisen
jälkeen, tulosta ei ole muokattu sen sulkeutumisen jälkeen.
