Ultimate Gemini Helper (UGH)



The ultimate free, in-browser ai assistant

The best completely free and open-source tool for in-browser ai assistance. Simply select text or images on a webpage, click the icon, and let the ai find the answers for you. This repository contains the full backend code (with an api), sample tampermonkey scripts (with a modified version of [Nyx's Universal Educational Tool Suite](https://greasyfork.org/en/scripts/550591-universal-educational-tool-suite) that uses the backend), and support for docker.

Table of Contents





[Features](#features)





[Backend](#backend)



[User Scripts](#user-scripts)



[Upcoming Features](#upcoming-features)



[Setup](#setup)





[Backend Setup](#backend-setup)



[Client Setup](#client-setup)



[Usage](#usage)





[Save your API Key](#save-your-api-key)



[Sample frontend.js usage](#sample-frontendjs-usage)



[Disclaimer (Skill Issue)](#disclaimer)

Features

Backend



Written with Python using FastAPI





Gemini Integration: The backend is built specifically for gemini, and uses the `gemini_webapi` library (https://pypi.org/project/gemini-webapi/) to use gemini completely for free without api keys.



Session Management: Uses either a local SQLite database or cloud PostgreSQL database to store your own api keys (with custom usage limits, basic tracking features, and chat persistance), and cache questions and their responses (to speed up the process for users asking the same questions).



Streaming Responses: Supports real-time streaming from the AI to provide a smoother user experience.



CORS Enabled: Fully configured for cross-origin requests from browser-environments.

User Scripts



These scripts STRICTLY rely on [Tampermonkey](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)





Backend Script ([backend.js](tampermonkey/backend.js))





Provides a simple interface to use event listeners to interact with the api on the backend.



Sample Frontend Script ([frontend.js (all webpages)](tampermonkey/frontend.js))





Sample script for how you can interact with the backend script from the client side. Make sure to use tampermonkey functions to bypass CORS policies if you want to do this yourself



Modified version of [Nyx's UETS](https://greasyfork.org/en/scripts/550591-universal-educational-tool-suite) [Universal Educational Tool Suite](tampermonkey/uets.js)





A modified version of Nyx's UETS that uses the custom backend 



This is still being actively developed to add support for more sites

Upcoming Features





Edpuzzle support: Add a gui injected into edpuzzles (including embeds) that allows for speed manipulation, automatic question answering, etc.



Canvas integration: Interface with canvas and better avoid detection.

Setup

Backend Setup





Clone the repository.



Install [docker-compose](https://docs.docker.com/compose/install/)



Configure environement variables: Create a .env file in the root directory:

SECURE_1PSID=your_google_1psid
SECURE_1PSIDTS=your_google_1psidts

CLOUDFLARE_TOKEN=your_cloudflare_tunnel_token # if you're using one
DATABASE_URL=your_database_url # leave blank if you want to use a local database (please dont do this)

GEMINI_COOKIE_PATH=/app/data/gemini_cookies # Im not sure if this is absolutely needed but it helps for readability




Refer to the instructions [here](https://github.com/HanaokaYuzu/Gemini-API?tab=readme-ov-file#authentication) on how to find secure_1psid and secure_1psidts

Read the [disclaimer](#disclaimer) for more information on these cookies





Execution

If using a cloud server, run:

docker-compose up -d --build


to build the docker image and execute it.

If using a home server, use startup.sh and create a service that runs

sudo startup.sh --refresh


on every restart (this is assuming your home isnt down too often, if it is, remove the --refresh argument).



Both of these implementations rely on cloudflare tunnels to expose themselves to the internet, modify the code as needed to match your usecase (See the [disclaimer](#usecase))

Client Setup





Install and setup the [Tampermonkey](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo) extension (See full instructions [here](https://gist.github.com/jesterjunk/0344f1a7c1f67f52ffc716b17ee7f240))



Install the scripts in the [tampermonkey](tampermonkey/) folder





backend.js (Required, does not need modification)



frontend.js (Optional, works on all sites but has worse UX)



uets.js (Optional, modified version of [Nyx's UETS](https://greasyfork.org/en/scripts/550591-universal-educational-tool-suite))





Configure your serverUrl in uets.js and apiUrl in backend.js

Usage

Save your API Key





Navigate to any webpage with all scripts enabled.



Hover over the icon in the bottom left.



Insert your custom API Key into the prompt.



From now on it should be saved permanently.

Sample frontend.js Usage





Navigate to any webpage with backend.js and frontend.js enabled.



Select any text or images on the page.



Click on the icon in the bottom left.



Wait for your answer(s) to load.

Disclaimer

Cookies

The code will automatically update the SECURE_1PSID and SECURE_1PSIDTS values if left running (and will store the values of them every 5 minutes), but if you open gemini logged into the same account that the script is running, theres a good chance it will desync these values, and you might have to edit the env to change them.

The script shouldnt have any cookie errors as long as you dont open the gemini webpage.

Timing

Sometimes gemini_webapi takes a significantly longer time than usual to generate a response, the cause of this is still unknown. Only fix is to increase the timeout in the client.init() function in [ai.py](ai.py).

Usecase

I'm a very amateur developer, this might not port well to your usecase, its mainly meant for me and a few close friends. I made this because I dont want to pay a crap ton of money for gemini api calls and also wanted what is essentially questionAI or all those cheating tools in my browser without paying their crazy subscriptions.
