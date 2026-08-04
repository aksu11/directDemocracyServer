const fs = require('fs');
const path = require('path');
const satori = require('satori').default;
const { Resvg } = require('@resvg/resvg-js');
const QRCode = require('qrcode');

// Open Graph -kuvien vakiokoko (ks. myös routes/share.js:n og:image:width/height).
const WIDTH = 1200;
const HEIGHT = 630;

const fontRegular = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'fonts', 'Roboto-Regular.woff'));
const fontBold = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'fonts', 'Roboto-Bold.woff'));

// Sama tumma väripaletti kuin sovelluksessa (ks. expo-app/constants/theme.ts).
const COLORS = {
  background:    '#121212',
  surface:       '#1E1E1E',
  surfaceBorder: '#2C2C2C',
  textPrimary:   '#F5F5F5',
  textSecondary: '#9E9E9E',
};

// Kuvan koko on kiinteä (1200x630), joten pitkä otsikko/kuvaus lyhennetään eikä
// vaihtoehtoja piirretä loputtomasti - Satori/Resvg ei vieritä ylivuotavaa sisältöä.
const MAX_OPTIONS = 6;

// Riittävän iso että kamerat tunnistavat QR-koodin luotettavasti myös pienestä
// esikatselukuvasta - tarkoituksella isompi kuin ympäröivä sisältö vaatisi, ja
// saa peittää alla olevaa sisältöä.
const QR_SIZE = 300;

function truncate(text, maxLength) {
  if (!text) return '';
  const trimmed = String(text).trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1).trimEnd()}…` : trimmed;
}

function h(type, style, children) {
  return { type, props: { style: { display: 'flex', ...style }, children } };
}

function img(src, size) {
  return { type: 'img', props: { src, width: size, height: size, style: { display: 'flex' } } };
}

function buildTree(poll, qrDataUrl) {
  const options = poll.options.slice(0, MAX_OPTIONS);

  const children = [
    h('div', {
      flexDirection: 'column',
      fontSize: 42,
      fontWeight: 700,
      color: COLORS.textPrimary,
      lineHeight: 1.25,
      marginBottom: 16,
    }, truncate(poll.question, 110)),

    poll.description
      ? h('div', {
          fontSize: 22,
          color: COLORS.textSecondary,
          lineHeight: 1.4,
          marginBottom: 28,
        }, truncate(poll.description, 190))
      : null,

    h('div', {
      fontSize: 24,
      fontWeight: 700,
      color: COLORS.textPrimary,
      marginBottom: 16,
    }, 'Lopullinen tulos:'),

    h('div', { flexDirection: 'column' }, options.map((option) => h('div', {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: COLORS.surface,
      border: `2px solid ${COLORS.surfaceBorder}`,
      borderRadius: 12,
      padding: '18px 26px',
      marginBottom: 14,
    }, [
      h('div', { fontSize: 24, color: COLORS.textPrimary }, String(option.label ?? '')),
      h('div', { fontSize: 24, fontWeight: 700, color: COLORS.textSecondary }, `${option.percentage ?? 0} %`),
    ]))),

    h('div', {
      marginTop: 'auto',
      justifyContent: 'flex-end',
      fontSize: 18,
      color: COLORS.textSecondary,
    }, 'Suora Demokratia'),
  ].filter(Boolean);

  const content = h('div', {
    width: WIDTH,
    height: HEIGHT,
    flexDirection: 'column',
    backgroundColor: COLORS.background,
    padding: '56px 64px',
    fontFamily: 'Roboto',
  }, children);

  if (!qrDataUrl) return content;

  // Absoluuttisesti aivan vasempaan alakulmaan (0,0-suhteessa koko kuvaan, ei
  // sisällön paddingiin) - tarkoituksella tarpeeksi iso (300x300) että kamerat
  // tunnistavat sen luotettavasti, vaikka se peittäisi alla olevaa sisältöä.
  const qrOverlay = h('div', {
    position: 'absolute',
    left: 0,
    bottom: 0,
    width: QR_SIZE,
    height: QR_SIZE,
  }, [img(qrDataUrl, QR_SIZE)]);

  return h('div', { width: WIDTH, height: HEIGHT, position: 'relative' }, [content, qrOverlay]);
}

/**
 * Renderöi päättyneen äänestyksen tulosnäkymän (otsikko - kuvaus - "Lopullinen
 * tulos:" - vaihtoehdot prosentteineen - QR-koodi + "Suora Demokratia") PNG-kuvaksi
 * somejakoa varten. `poll.options`-kentässä on oltava jo valmiiksi lasketut
 * `percentage`-arvot (ks. services/pollFormat.js:n withPercentages).
 *
 * `pollUrl` on valinnainen - jos annettu, kuvan vasempaan alakulmaan piirretään
 * QR-koodi joka johtaa suoraan tähän äänestykseen (sama osoite kuin sivun
 * og:url, ks. routes/share.js). Ilman sitä QR-koodi jätetään pois.
 */
async function renderEndedPollImage(poll, pollUrl) {
  const qrDataUrl = pollUrl
    ? await QRCode.toDataURL(pollUrl, { margin: 2, width: QR_SIZE })
    : null;

  const svg = await satori(buildTree(poll, qrDataUrl), {
    width: WIDTH,
    height: HEIGHT,
    fonts: [
      { name: 'Roboto', data: fontRegular, weight: 400, style: 'normal' },
      { name: 'Roboto', data: fontBold, weight: 700, style: 'normal' },
    ],
  });

  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: WIDTH } });
  return resvg.render().asPng();
}

module.exports = { renderEndedPollImage };
