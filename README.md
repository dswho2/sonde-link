Engineering Challenge
Query our live constellation API

The current positions of our global sounding balloons are at https://a.windbornesystems.com/treasure/00.json.
01.json is the state an hour ago, 03.json is from three hours ago, etc, up to 23H ago.
The outputs are undocumented and may sometimes be corrupted—sorryy ¯\(ツ)/¯.
You should robustly extract the available flight history for our constellation
Find another existing public dataset/API and combine these two into something!

The world is your oyster—have fun with it 🤔
This should be the meat of the project, explore and find something interesting and cool to you!
What insights or problems could you tackle with both of these data feeds?
Remember, our API is live, so whatever you build should update dynamically with the latest 24H of data.
Add a sentence to the notes explaining why you chose the external api/dataset you did!
Host your creation on a publicly accessible URL

We can't wait to see what you build!
this should be the actual interative webpage, not a static github repo link to the src



Example data from windborne api:
[
    [
        -84.73776739257201,
        -36.36046938462287,
        17.294846123609965
    ],
    [
        -35.18564590371175,
        154.02374486042427,
        13.288664217255022
    ],
    [
        70.6816475412965,
        -88.36481252655891,
        11.95460366880121
    ],
    [
        -32.58189727033158,
        -55.92346950955876,
        19.054735180153763
    ],
    ...
]