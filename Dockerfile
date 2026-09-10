# ============================================================================
# L'image est grosse (environ 1,3 Go) : LibreOffice y est, et c'est lui qui
# permet a un participant d'envoyer son .pptx sans se poser de question.
#
# Debian plutot qu'Alpine : LibreOffice y est complet et teste, alors qu'Alpine
# demande des contorsions pour le meme resultat.
#
# Par rapport a Impression Express, dont cette image descend : CUPS et
# Ghostscript sont partis. On n'imprime rien, et la mesure du remplissage en
# encre n'a aucun sens pour une reunion.
# ============================================================================

FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    ECR_DATA_DIR=/data \
    DEBIAN_FRONTEND=noninteractive \
    HOME=/tmp

RUN apt-get update && apt-get install -y --no-install-recommends \
      # Les PDF vers des images de pages : pdftoppm. C'est le coeur du projet.
      poppler-utils \
      # Les images : ImageMagick pour la mise a l'echelle et l'orientation,
      # heif-convert pour les photos d'iPhone.
      imagemagick libheif-examples \
      # La bureautique.
      libreoffice-writer libreoffice-calc libreoffice-impress \
      fonts-dejavu fonts-liberation \
      # Le QR code affiche sur l'ecran de la salle.
      qrencode \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Chaque ajout de paquet dans SA PROPRE couche, et ce n'est pas de la
# coquetterie : ajouter un paquet au bloc precedent l'invaliderait en entier et
# le NAS retelechargerait tout LibreOffice — une demi-heure pour quelques
# mega-octets. La ligne ci-dessous est le modele a suivre pour la suite.
#
# (Rien a ajouter pour l'instant : elle attend la phase 4 et les videos.)

WORKDIR /app

# Aucune dependance npm : package.json ne fait que decrire le projet.
COPY package.json ./
COPY server.js ./
COPY src ./src
COPY public ./public
# Le banc d'essai voyage avec l'application : c'est le seul moyen d'eprouver la
# conversion la ou LibreOffice et poppler existent vraiment — dans le
# conteneur, pas sur le poste Windows.
COPY tests ./tests

RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 8802

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8802/api/sante').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
