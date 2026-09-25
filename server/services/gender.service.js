/*
  Best-effort gender for a creator, inferred from their display name.

  WHY THIS IS AN ESTIMATE AND NOT A LOOKUP.
  Instagram does not expose gender anywhere, and neither of the scrapers this
  app runs returns it (checked: profile and reel output carry fullName,
  username, bio and counts, nothing on gender). There is nothing to fetch, so
  this reads the first name and matches it against a list of common first
  names. Anything it is not sure about comes back null and shows as
  "Unknown" rather than a guess. A wrong label on a client-facing screen is
  worse than an honest blank.

  Every value produced here is stored with genderSource 'inferred'. A person
  can override it from the Creators screen, which stores 'manual', and an
  override is never touched by a later inference (see recordAnalyzedCreator).

  Display names on Instagram are messy: emoji, Unicode "fancy fonts",
  taglines after a separator ("Kratika | Fashion | Travel"). normalize()
  flattens the fancy-font letters back to plain ones (NFKD does this for the
  mathematical alphanumerics) and drops everything that is not a letter.
  Names written in another script (Devanagari and so on) are not handled and
  fall through to null.
*/

const FEMALE = new Set(`
aarti aarohi aastha aditi aishwarya akansha akanksha alka amisha amrita anamika ananya anchal angel anita anjali anjana
ankita annu anshika anukriti anupama anusha anvi apeksha archana arohi arpita aru arushi asha ashwini avni ayesha ayushi
babita bhavna bhavya bhawna bhumika bindu binita bipasa bipasha chandni charu chetna chhavi dimple deepa deepika deepti
devika dhara dhruvi diksha disha diya divya dolly drishti ekta esha falguni garima gargi gauri gayatri geeta gunjan gungun
harshada harshita heena hema hetal hina himani indu isha ishita jahnvi janhvi jasleen jaya jhanvi jiya juhi jyoti jyotsna
kajal kajol kalpana kamini kamna kanchan kanika kanak kareena karishma kashish kavita kavya khanak khushi khyati kirti
komal kratika kriti kritika lakshmi lata lavanya lipika madhu mahima mahi maithili mallika mamta manisha manju manvi mansi
maansi meena meenakshi megha meghna mehak mehula mira mitali mohini monika mridula mukta muskan nabila naina nalini
namrata nancy nandini neelam neelu neetu neha nidhi nikita niharika nisha nitu nitya nupur palak pallavi pankhuri parul
pari parimita payal pihu pinki pinky piu pooja poonam prachi pragya prajakta pratibha preeti prerna prisha priti prity
priya priyanka puja purnima purva radha radhika rachna ragini rakhi rani rashmi rekha renu reshma rhea richa riddhi
rimjhim rinki ritika ritu riya roshni ruchi rupal rupali saanvi sabina sadhna sakshi saloni sana sangeeta sania sanjana
sanchi sanya sapna sara sarika sarita sayali sejal seema shagun shalini shanti sharda sharmila shefali sheetal shikha
shilpa shivangi shivani shobha shraddha shreya shruti shubhi shweta sia simran siya smriti sneha sonal sonali sonam sonia
soniya srishti stuti subhashree suchismita sudha sunita supriya surbhi sushma sushmita swati sweety tamanna tannu tanu
tanvi tanya tara teena tina trisha tripti tulsi twinkle urvashi usha vaishali vandana vani varsha vartika veena vibha
vidhi vimla vineeta vrinda yamini yashika yogita zainab zara zoya aisha fatima mary jennifer emma olivia sophia anna
sarah jessica emily lisa laura kylie kendall taylor ashley amanda nicole megan rachel hannah lauren anushka anahita poornima nishu rehena paro manilata vaishnavi kirtika pratiksha rupa sunaina sushila laxmi nutan rubina ruby samiksha sanika sharanya shristi shreeya sonakshi sumaiya vaidehi vanshika vidya vishakha yashvi zeenat ishika ishani ira ipsita janvi jasmine kalyani kamakshi karuna kashvi kavisha kusum latika leena madhuri mahek mamata manasi mansha meera minal minakshi mishti mona mugdha nazia nilam nimisha nirmala nivedita pavni payel pragati pratima preksha raina rajni rakshita ranjana rashi rasika ridhima risha ronita sabrina sadia saima salma samantha sampada sanskriti saraswati sargam savita shabana shaina shakti shama shanaya sharon shazia shilpi shivika sikha sima simi sindhu snehal sohini sonika sreya sristi subhadra sujata sumita sunanda surabhi suvarna swarna tabassum tanisha tanushree taruna tejal trishna ujjwala upasana urmi vaani vandita vasudha vedika vinita yashasvi yukti zeba
`.split(/\s+/).filter(Boolean));

const MALE = new Set(`
aakash aarav abhay abhijeet abhinav abhishek aditya ajay ajit akash akhil akshay alok aman amar amit amitabh anand anil
anirudh ankit ankur anmol anuj arjun arun arvind ashish ashok atul ayush bharat bhavesh chetan chirag deepak deepesh dev
devendra dhiraj dhruv dinesh gaurav girish gopal govind harsh harshit hemant himanshu hitesh imran ishan jatin jay jayesh
kabir kamal karan kartik kishore kunal kush lakshay lalit luv mahesh manish manoj mayank mohan mohit mridul mukesh naman
naveen neeraj nikhil nishant nitin omkar pankaj parth piyush pradeep prakash pranav prashant pratik praveen prem rahul
rajat rajesh rakesh ram ramesh ranjit ravi ritesh rishabh rohan rohit sachin sagar sahil sameer sandeep sanjay santosh
saurabh shivam shubham siddharth sumit sunil suraj suresh tanmay tarun tejas tushar uday umesh varun vijay vikas vikram
vinay vinod vipul vishal vivek yash yogesh john michael david james robert william chris daniel mark paul kevin brian
steven jason jeff ryan justin brandon aryan arnav ashwin avinash bhupendra brijesh dheeraj dilip ganesh hari harish jagdish jitendra karthik keshav krish lokesh madan mahendra mandeep mithun mukul nagesh narendra nilesh nirmal pavan prabhat pramod pranay pratap puneet raghav rajiv rajendra raju ranveer ritik rishi rudra sanket satish shailesh shashank shiv shrey siddhant subhash sudhir sujit swapnil tanish tapan vaibhav vedant vimal vishnu vishwas yuvraj zaid salman rizwan faizan irfan
`.split(/\s+/).filter(Boolean));

// Words that appear in display names but are never the first name. Dropped
// before matching so "It's me Ritu" reads as "ritu".
const STOPWORDS = new Set(['it', 's', 'its', 'me', 'i', 'am', 'im', 'the', 'mr', 'mrs', 'miss', 'ms', 'dr', 'official', 'not', 'ur', 'your']);

function normalize(text) {
  return String(text || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function lookup(token) {
  if (FEMALE.has(token)) return 'female';
  if (MALE.has(token)) return 'male';
  return null;
}

// Only the first two real words are considered, so a surname that happens to
// be a first name elsewhere ("Kiran Raj") cannot flip the answer.
function inferFromName(name) {
  const tokens = normalize(name).slice(0, 2);
  for (const t of tokens) {
    const g = lookup(t);
    if (g) return g;
  }
  return null;
}

// Handles like "muskandubey_" or "dimplepanwarchhikara18" often start with the
// first name. Prefix-only, and only for names of 4+ letters, so a short name
// cannot match the front of an unrelated word.
const BY_LENGTH_DESC = [...FEMALE, ...MALE].filter((n) => n.length >= 4).sort((a, b) => b.length - a.length);
function inferFromHandle(username) {
  const handle = String(username || '').toLowerCase().replace(/[^a-z]/g, '');
  if (handle.length < 4) return null;
  for (const n of BY_LENGTH_DESC) {
    if (handle.startsWith(n)) return lookup(n);
  }
  return null;
}

function inferGender({ name, username } = {}) {
  return inferFromName(name) || inferFromHandle(username) || null;
}

module.exports = { inferGender };
