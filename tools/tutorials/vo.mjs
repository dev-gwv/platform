// The voice-over, per video: the title card's line, one line per counted
// step (in the order the script calls t.step), and the end card's line.
// English and Hindi, from the approved script doc.
const L = (en, hi) => ({ en, hi })
export const VO = {
  team: {
    title: L("Let's add one person to your team. It takes a minute.", 'चलिए, अपनी टीम में एक व्यक्ति जोड़ते हैं। बस एक मिनट लगेगा।'),
    steps: [
      L('On the Team page, pick One by one.', 'Team पेज पर One by one चुनिए।'),
      L('Type their name and mobile number.', 'उनका नाम और मोबाइल नंबर लिखिए।'),
      L('Tap the job they get booked for, like candid photographer.', 'जिस काम के लिए वे बुक होते हैं, उस पर टैप कीजिए, जैसे कैंडिड फ़ोटोग्राफ़र।'),
      L('Want them to sign in? Give any email as their username, and a password.', 'उन्हें साइन इन करवाना है? यूज़रनेम के लिए कोई भी ईमेल और एक पासवर्ड दीजिए।'),
      L('Press Add to team.', 'Add to team दबाइए।'),
    ],
    end: L('Ravi is on your team, and can sign in on his own phone.', 'रवि अब आपकी टीम में है, और अपने फ़ोन पर साइन इन कर सकता है।'),
  },
  'team-bulk': {
    title: L('Got a big team? Add everyone in one go.', 'टीम बड़ी है? सबको एक साथ जोड़िए।'),
    steps: [
      L('Tap Add your team.', 'Add your team पर टैप कीजिए।'),
      L('One row per person: just a name and a mobile number.', 'हर व्यक्ति की एक लाइन: बस नाम और मोबाइल नंबर।'),
      L('Want them to sign in? Any email works. It is only their username.', 'उन्हें साइन इन करवाना है? कोई भी ईमेल चलेगा, यह बस उनका यूज़रनेम है।'),
      L('A freelancer? Switch them to Per shoot.', 'फ़्रीलांसर हैं? उन्हें Per shoot पर कर दीजिए।'),
      L('Press Add, and you are done.', 'Add दबाइए, बस हो गया।'),
    ],
    end: L('Your team is in. Next, your first client.', 'आपकी टीम जुड़ गई। अब, आपका पहला क्लाइंट।'),
  },
  client: {
    title: L('Now your first client: the couple or family you shoot for.', 'अब आपका पहला क्लाइंट: वह कपल या परिवार जिनके लिए आप शूट करते हैं।'),
    steps: [
      L('Open Clients and press New client.', 'Clients खोलिए और New client दबाइए।'),
      L("Type the client's name.", 'क्लाइंट का नाम लिखिए।'),
      L('Add their mobile number.', 'उनका मोबाइल नंबर डालिए।'),
      L('Press Save client.', 'Save client दबाइए।'),
    ],
    end: L('Saved once, and you can pick Priya anywhere in the app.', 'एक बार सेव, और प्रिया को ऐप में कहीं भी चुन सकते हैं।'),
  },
  project: {
    title: L("Let's book your first project: days, deliverables and price, all in one place.", 'चलिए, आपका पहला प्रोजेक्ट बनाते हैं: दिन, डिलिवरेबल्स और कीमत, सब एक जगह।'),
    steps: [
      L('Name the project, and pick the client.', 'प्रोजेक्ट का नाम लिखिए, और क्लाइंट चुनिए।'),
      L('Tap Haldi, then its date, start time and how many hours.', 'Haldi पर टैप कीजिए, फिर उसकी तारीख, शुरू होने का समय और कितने घंटे।'),
      L('Then the Wedding, the same way.', 'फिर Wedding, बिल्कुल इसी तरह।'),
      L('Tap what the client gets: teaser, film, album.', 'क्लाइंट को जो मिलेगा, उस पर टैप कीजिए: टीज़र, फ़िल्म, एल्बम।'),
      L('Enter the package price, and any advance already paid.', 'पैकेज की कीमत डालिए, और जो एडवांस मिल चुका है वह भी।'),
      L('Check it all, then press Create project.', 'सब एक बार देख लीजिए, फिर Create project दबाइए।'),
    ],
    end: L('Done. Your quotation is ready to send.', 'हो गया। आपका कोटेशन भेजने के लिए तैयार है।'),
  },
  'project-client': {
    title: L('Step one: who the project is for.', 'पहला स्टेप: प्रोजेक्ट किसके लिए है।'),
    steps: [
      L("Name the project, like Priya and Rahul's Wedding.", 'प्रोजेक्ट का नाम लिखिए, जैसे प्रिया और राहुल की शादी।'),
      L('Pick the client, or add a new one right here.', 'क्लाइंट चुनिए, या यहीं नया जोड़िए।'),
      L('Press Next: Event days.', 'Next: Event days दबाइए।'),
    ],
    end: L('Now add the days you shoot.', 'अब शूट के दिन जोड़िए।'),
  },
  'project-shoots': {
    title: L('Step two: each function, with its date and hours.', 'दूसरा स्टेप: हर फ़ंक्शन, उसकी तारीख और घंटों के साथ।'),
    steps: [
      L('Tap a function to add its day. Here, the Haldi.', 'फ़ंक्शन पर टैप करके उसका दिन जोड़िए। यहाँ, हल्दी।'),
      L('Pick the date and the start time.', 'तारीख और शुरू होने का समय चुनिए।'),
      L("Tap how many hours it runs. Your team's day is planned from this.", 'कितने घंटे चलेगा, उस पर टैप कीजिए। आपकी टीम का दिन इसी से प्लान होता है।'),
      L('Add requirements: who this day needs.', 'Add requirements: इस दिन किसकी ज़रूरत है।'),
      L('Add the Wedding the same way.', 'Wedding भी इसी तरह जोड़िए।'),
    ],
    end: L('Every delivery date now counts from these days.', 'अब हर डिलीवरी की तारीख इन्हीं दिनों से गिनी जाती है।'),
  },
  'project-deliverables': {
    title: L('Step three: what the client gets.', 'तीसरा स्टेप: क्लाइंट को क्या मिलेगा।'),
    steps: [
      L('Tap each thing in the package.', 'पैकेज की हर चीज़ पर टैप कीजिए।'),
      L('Each one gets its due date from the wedding day.', 'हर एक की ड्यू डेट शादी के दिन से अपने आप तय होती है।'),
      L('Press Next: Price.', 'Next: Price दबाइए।'),
    ],
    end: L('What they get, with every due date set.', 'क्या मिलेगा, हर ड्यू डेट के साथ।'),
  },
  'project-billing': {
    title: L('Last step: the price.', 'आखिरी स्टेप: कीमत।'),
    steps: [
      L('Type the package price.', 'पैकेज की कीमत लिखिए।'),
      L("Already paid an advance? Add it here. It's optional.", 'एडवांस मिल चुका है? यहाँ डालिए। यह ज़रूरी नहीं है।'),
      L('Then Next: Review. The balance to collect is worked out for you.', 'फिर Next: Review। कितना बाकी लेना है, अपने आप निकल आता है।'),
      L('Press Create project.', 'Create project दबाइए।'),
    ],
    end: L('Your quotation opens, ready to send.', 'आपका कोटेशन खुल जाता है, भेजने के लिए तैयार।'),
  },
  leads: {
    title: L("An enquiry comes in. Here's how it becomes a booking.", 'एक इन्क्वायरी आई। देखिए यह बुकिंग कैसे बनती है।'),
    steps: [
      L('On Leads, tap Add lead.', 'Leads पर Add lead पर टैप कीजिए।'),
      L('A number and a name is enough to start.', 'शुरू करने के लिए नंबर और नाम काफ़ी है।'),
      L('Pick the event and its date.', 'इवेंट और उसकी तारीख चुनिए।'),
      L('When they say yes, open the lead and press Book it.', 'जब वे हाँ कहें, लीड खोलिए और Book it दबाइए।'),
      L('Name the project, set the price, and book it.', 'प्रोजेक्ट का नाम और कीमत डालिए, और बुक कीजिए।'),
    ],
    end: L('Booked, and the quotation is ready to send. Every enquiry, one tap from booked.', 'बुक हो गया, और कोटेशन भेजने के लिए तैयार है। हर इन्क्वायरी, बुकिंग से बस एक टैप दूर।'),
  },
  quotation: {
    title: L('Your quotation, checked and sent in under a minute.', 'आपका कोटेशन, एक मिनट से कम में जाँचा और भेजा।'),
    steps: [
      L('It fills in by itself from the project.', 'यह प्रोजेक्ट से अपने आप भर जाता है।'),
      L('Check it first: open Send to client.', 'पहले जाँच लीजिए: Send to client खोलिए।'),
      L('See it as the client shows exactly what they will see.', 'See it as the client से वही दिखता है जो क्लाइंट देखेगा।'),
      L('Looks right? Go back to your view.', 'सही है? अपने व्यू पर वापस जाइए।'),
      L('Press Send to client, then Copy link.', 'Send to client दबाइए, फिर Copy link।'),
    ],
    end: L('Paste it on WhatsApp. The client opens it in one tap.', 'इसे WhatsApp पर भेजिए। क्लाइंट एक टैप में खोल लेता है।'),
  },
  assign: {
    title: L('Book your crew for a shoot, without a single phone call.', 'एक भी फ़ोन किए बिना, शूट के लिए अपनी टीम बुक कीजिए।'),
    steps: [
      L('Each day shows who it needs. Tap Assign team.', 'हर दिन पर लिखा है किसकी ज़रूरत है। Assign team पर टैप कीजिए।'),
      L('Choose a person for each role. Each name says if they are free that day.', 'हर रोल के लिए एक व्यक्ति चुनिए। हर नाम के साथ लिखा है कि उस दिन वे फ़्री हैं या नहीं।'),
      L('Their pay fills in from their usual wedding rate.', 'उनका पेमेंट उनके रोज़ के वेडिंग रेट से अपने आप भर जाता है।'),
      L('Two of two chosen. Press Book.', 'दो में से दो चुन लिए। Book दबाइए।'),
      L('Booked. Press Done.', 'बुक हो गया। Done दबाइए।'),
    ],
    end: L("The wedding day is staffed, with each person's pay.", 'शादी का दिन टीम से भर गया, हर व्यक्ति के पेमेंट के साथ।'),
  },
  'give-work': {
    title: L('Hand a film to an editor in one step.', 'एक स्टेप में फ़िल्म एडिटर को सौंपिए।'),
    steps: [
      L("Open the project's Post-production tab.", 'प्रोजेक्ट का Post-production टैब खोलिए।'),
      L('Nobody on the teaser yet? Tap Start editing.', 'टीज़र पर अभी कोई नहीं? Start editing पर टैप कीजिए।'),
      L('Each editor shows how much they already have.', 'हर एडिटर के साथ दिखता है कि उनके पास पहले से कितना काम है।'),
      L('The due date is filled in. Add a line of brief.', 'ड्यू डेट भरी हुई है। एक लाइन का ब्रीफ़ लिखिए।'),
      L('Tap Start editing with Kavya.', 'Start editing with Kavya पर टैप कीजिए।'),
    ],
    end: L("It's on Kavya's own list now, and you hear when she hands it in.", 'अब यह काव्या की अपनी लिस्ट पर है, और जमा होने पर आपको पता चल जाएगा।'),
  },
  board: {
    title: L('All your editing work, on one board.', 'आपका सारा एडिटिंग का काम, एक बोर्ड पर।'),
    steps: [
      L('Late work, work due today, and work with no editor: counted for you.', 'लेट काम, आज का काम, और बिना एडिटर वाला काम: सब गिना हुआ।'),
      L('Reels edited? Drag the card to the next stage.', 'रील्स एडिट हो गईं? कार्ड को अगले स्टेज पर खींच दीजिए।'),
      L('Switch to List. Late work is always on top.', 'List पर जाइए। लेट काम हमेशा सबसे ऊपर है।'),
      L('Tick the work that has nobody on it.', 'जिस काम पर कोई नहीं है, उस पर टिक कीजिए।'),
      L('Two selected. Give to Kavya, both at once.', 'दो चुने। Give to से काव्या को, दोनों एक साथ।'),
    ],
    end: L("Both are Kavya's now, ready for her to start.", 'दोनों अब काव्या के पास हैं, शुरू करने के लिए तैयार।'),
  },
  'team-day': {
    title: L('This is what your team sees on their own phone.', 'यह है जो आपकी टीम अपने फ़ोन पर देखती है।'),
    steps: [
      L('Ravi signs in. His day, in time order.', 'रवि साइन इन करता है। उसका दिन, समय के क्रम में।'),
      L("At the Haldi venue, he taps I've reached. That is his attendance today.", "हल्दी के वेन्यू पर वह I've reached दबाता है। यही आज की उसकी अटेंडेंस है।"),
      L("Tonight's Sangeet: he taps Confirm, so the studio knows.", 'आज रात का संगीत: वह Confirm दबाता है, ताकि स्टूडियो को पता रहे।'),
      L("Starting the teaser? He taps I've started.", "टीज़र शुरू किया? वह I've started दबाता है।"),
      L('My work shows every edit, its stage, and the days left.', 'My work में हर एडिट, उसका स्टेज, और बचे हुए दिन दिखते हैं।'),
    ],
    end: L("Reached, confirmed, editing. Ravi's day is on track.", 'पहुँचा, कन्फ़र्म किया, एडिटिंग शुरू। रवि का दिन सही चल रहा है।'),
  },
  payments: {
    title: L("See what's due, and mark money in.", 'देखिए क्या बाकी है, और आया पैसा दर्ज कीजिए।'),
    steps: [
      L('Overdue, due soon, later and received, at a glance.', 'Overdue, जल्द ड्यू, बाद में, और मिला हुआ, एक नज़र में।'),
      L("Tap Overdue to see who owes you. Priya's advance is five days late.", 'Overdue पर टैप कीजिए। प्रिया का एडवांस पाँच दिन लेट है।'),
      L('Open the invoice.', 'इनवॉइस खोलिए।'),
      L('Tap Add payment from client.', 'Add payment from client पर टैप कीजिए।'),
      L('The Record payment form opens with the amount filled in. Pick UPI, and add the UTR.', 'Record payment फ़ॉर्म में रकम भरी हुई है। UPI चुनिए, और UTR डालिए।'),
    ],
    end: L('Counted in Received, and nothing is overdue now.', 'Received में गिना गया, अब कुछ भी लेट नहीं।'),
  },
  payouts: {
    title: L('Pay your crew for shoots already done, in a tap.', 'हो चुके शूट का पेमेंट, एक टैप में।'),
    steps: [
      L('Team, Pay, Team payouts: here is who you owe now.', 'Team, Pay, Team payouts: यहाँ दिखता है अभी किसका बकाया है।'),
      L('Ravi shot the wedding. Tap Pay.', 'रवि ने शादी शूट की। Pay पर टैप कीजिए।'),
      L('His UPI is here, and the amount is filled in.', 'उसका UPI यहाँ है, और रकम भरी हुई है।'),
      L('Pick how you paid, and add the UTR.', 'कैसे पेमेंट किया चुनिए, और UTR डालिए।'),
      L('Save, and it is paid.', 'सेव कीजिए, पेमेंट हो गया।'),
    ],
    end: L("Only Neha's nine thousand is still owed. Your crew, paid on time.", 'अब बस नेहा के नौ हज़ार बाकी हैं। आपकी टीम, समय पर पेमेंट।'),
  },
  invoices: {
    title: L('An invoice, made from the project and sent as a link.', 'इनवॉइस, प्रोजेक्ट से बना और लिंक से भेजा।'),
    steps: [
      L("On the project's Billing, tap Create invoice.", 'प्रोजेक्ट के Billing में Create invoice पर टैप कीजिए।'),
      L('Priya and her project are already filled in.', 'प्रिया और उसका प्रोजेक्ट पहले से भरे हैं।'),
      L('The booked package is already on the first line.', 'बुक किया पैकेज पहली लाइन में पहले से है।'),
      L('Press Save and send.', 'Save and send दबाइए।'),
      L('Open it to share it.', 'भेजने के लिए इसे खोलिए।'),
      L('Tap Client link. Priya opens it without a login.', 'Client link पर टैप कीजिए। प्रिया इसे बिना लॉगिन खोल लेती है।'),
    ],
    end: L("An invoice on Priya's phone in a minute.", 'एक मिनट में इनवॉइस प्रिया के फ़ोन पर।'),
  },
  expenses: {
    title: L('Every rupee spent, on the right project.', 'हर खर्च किया रुपया, सही प्रोजेक्ट पर।'),
    steps: [
      L('Tap Add expense.', 'Add expense पर टैप कीजिए।'),
      L('Type the amount.', 'रकम लिखिए।'),
      L('Pick a category from the list.', 'लिस्ट से कैटेगरी चुनिए।'),
      L('Who paid? Here, Ravi paid from his own pocket.', 'किसने दिया? यहाँ, रवि ने अपनी जेब से दिया।'),
      L('Put it on the project it belongs to.', 'जिस प्रोजेक्ट का खर्च है, उस पर डालिए।'),
      L('Press Add expense to save it.', 'सेव करने के लिए Add expense दबाइए।'),
    ],
    end: L("It counts this month, and Ravi's money waits under To reimburse until you pay him back.", 'यह इस महीने में गिना गया, और रवि का पैसा लौटाने तक To reimburse में रहेगा।'),
  },
  attendance: {
    title: L("Attendance that marks itself. Here's how to switch it on.", 'अटेंडेंस जो अपने आप लगती है। देखिए इसे कैसे चालू करें।'),
    steps: [
      L('Settings, Attendance. It stays off until you turn it on.', 'Settings, Attendance। आप चालू करें, तब तक यह बंद रहती है।'),
      L("Paste your studio's Google Maps link.", 'अपने स्टूडियो का Google Maps लिंक पेस्ट कीजिए।'),
      L('How close counts as in? Pick a radius, then save.', 'कितनी दूरी तक हाज़िर माना जाए? दायरा चुनिए, फिर सेव कीजिए।'),
      L('Set when the day starts and ends.', 'दिन कब शुरू और कब खत्म होता है, सेट कीजिए।'),
      L('Pick the weekly off, and save working hours.', 'हफ़्ते की छुट्टी चुनिए, और Save working hours दबाइए।'),
    ],
    end: L("It's on. From today, your team checks in at the studio.", 'चालू हो गई। आज से आपकी टीम स्टूडियो पर चेक इन करेगी।'),
  },
  leave: {
    title: L("See what's left, then say yes in one tap.", 'कितनी छुट्टी बची है देखिए, फिर एक टैप में हाँ कहिए।'),
    steps: [
      L('Open Team, Attendance and leave.', 'Team, Attendance and leave खोलिए।'),
      L("Then Leave and holidays. To approve shows who's waiting.", 'फिर Leave and holidays। To approve में दिखता है कौन इंतज़ार में है।'),
      L('Ravi asked for two days, and says why.', 'रवि ने दो दिन की छुट्टी माँगी है, वजह के साथ।'),
      L('It checks his balance: nine days left, this is two.', 'यह उसका बैलेंस जाँचता है: नौ दिन बचे, यह दो दिन की है।'),
      L('Tap Approve. Ravi is told straight away.', 'Approve पर टैप कीजिए। रवि को तुरंत पता चल जाता है।'),
      L('Balances shows what he has left.', 'Balances में दिखता है कि उसके पास कितनी बची है।'),
    ],
    end: L('Leave, decided in one tap.', 'छुट्टी का फ़ैसला, एक टैप में।'),
  },
}
