const text = `[Page 1]
Cryptography & Network Security ______________________________ Dr Naga Jyothi Pothabathula Emp. ID: 1913 Assistant Professor npothaba@gitam.edu 98662 60321 GSCSE, GITAM UNIVERSITY, Visakhapatnam
[Page 2]
Course Particulars • Course Code : CSEN2071 • Category : Core CSE • Credits : 03 • Faculty Name : Dr P Naga Jyothi • Offered to : ¾ B. Tech (CSE/CS) Pre-Requisites • Offered to : ¾ B. Tech (CSE/CS) • Semester : 6 • Start of Sem: 01-12-2025 • Academic year : 2025-2026 • Offering Dept. : CSE, GSCSE, Visakhapatnam • Computer Networks • Mathematical background
[Page 3]
Cryptography & Network Security Syllabus • Introduction and Classical Encryption Techniques • Symmetric Key Cryptography • Number Theory and Cryptography • Cryptographic Hash Functions • Key Management and Distributions, User Authentication
[Page 4]
Course description The aim of this course is to introduce about information Security concepts to the students. This course develops a basic understanding of goals, threats, attacks and mechanisms of security, the algorithms and their design choices. The course also familiarizes students with a few mathematical concepts used in cryptology. The course emphasizes to give a basic understanding of attacks in cryptosystems as well, how to shield information from attacks. It also deals with message authentication, Digital signatures and Network security . message authentication, Digital signatures and Network security . Course Objectives • Understand security concepts, goals, threats and Security services, mechanisms to counter them. (L2) • Comprehend and apply Classical Encryption Techniques. (L3) • Understand various symmetric cryptographic techniques. (L2) • Learn number theory related to Modern Cryptography. (L2) • Learn different kinds of Message Authentication Techniques. (L2)
[Page 5]
Course outcomes After completion of this course, the student will be able to: ∙ distinguish between Symmetric and Asymmetric cryptosystems (L4) ∙ analyze and implement Symmetric Classical Ciphers (L4) ∙ analyze and implement Symmetric Classical Ciphers (L4) ∙ explain Hash functions and its algorithms (L2) ∙ apply Digital signature and its algorithms (L3) ∙ discuss public key distribution, Kerberos (L6) ∙ understand security at application and transportation layers. (L2)
[Page 6]
Module-1 Syllabus • Introduction : • Computer Security Concepts • The OSI Security Architecture • Cryptography • Cryptanalysis, attacks, services, security mechanisms. • Classical Encryption Techniques: • Classical Encryption Techniques: • Substitution Techniques • Caesar Cipher • Monoalphabetic Ciphers • Playfair Cipher • Hill Cipher • Polyalphabetic Ciphers. • Transposition Techniques
[Page 7]
Security Y security is needed? Ex. Working with a bank we should work on the internet • Attackers need intelligence and they are the intelligent people so we focus on protecting our data and infrastructure ,system and network --- so that we can be safe. so that we can be safe. • Once we enter data into the system it will be available on the internet— Then what we should do? • We should not place in wrong hands—they should not be able know the data • Every one will be there on the internet- attackers , myself ,your self • Bank is having many security measures— if the password is not having encryption • Or else attacker can create bogus server then also he can also hack the data-phishing attack
[Page 8]
Cryptology, Cryptography & Cryptanalysis • Greek word : kryptós = “hidden” and graphein = “to write”. • Cryptology = “Study of codes, both hiding and solving them both hiding and solving them • Cryptography = Art of creating codes • Cryptanalysis = Analyzing or breaking the coded message
[Page 9]
Key terms • Cryptography is art of CS that converts plain text to cipher text and cipher text to plain text • Plain text- msg/img/animation/audio/video/text/numbers sender wants to send • Ex. whatapp end to end encryption • Cipher text – scrambled msg • Cipher- encryption algorithms- key is most critical • Key- is most critical n concern for security • Cryptanalysis- code breaking done by the attackers – by breaking the cipher / knowing the plain text • Cryptology- combination of cryptography (plain –cipher and cipher to plain) and cryptanalysis( done by attackers)
[Page 10]
Cryptography Cryptography is a method of protecting information and communications through the use of codes, so that only those for whom the information is intended can read and process it. Cryptanalysis is used to breach cryptographic security systems and gain access to the contents of encrypted messages, even if the cryptographic key is unknown.
[Page 11]
Computer Security Concepts • Definition (NIST): • The protection afforded to an automated information system in order to attain the applicable objectives of preserving the integrity, availability, and confidentiality of information system objectives of preserving the integrity, availability, and confidentiality of information system resources (includes hardware, software, firmware, information/data, and telecommunications). The 3 concepts introduced in this definition are shown below. They are also called as CIA Traid. • Confidentiality • Integrity • Availability
[Page 12]
CIA Triad
[Page 13]
Cryptography & Network Security Plain Text : Is the original message Cipher Text : Is the encrypted message Encryption : transforming information from readable format into unreadable format Encryption : transforming information from readable format into unreadable format Decryption : transforming information from unreadable format to readable format Key : a string of bits used by a cryptographic algorithm to transform plain text into cipher text or vice-versa.
[Page 14]
Model for computer security The assets of a computer system are as follows: • Hardware: Including computer systems and other data processing, data storage, and data communications devices • Software: Including the operating system, system utilities, and applications. • Data: Including files and databases, as well as security-related data, such as password files. • Communication facilities and networks: Local and wide area network communication links, bridges, routers, and so on. links, bridges, routers, and so on. Adversary (threat agent) : An entity that attacks, or is a threat to, a system. Attack: an intelligent act that is a deliberate attempt to evade security services and violate the security policy of a system. Countermeasure An action, device, procedure, or technique that reduces a threat, a vulnerability, or an attack by eliminating or preventing it. Risk An expectation of loss expressed as the probability that a threat will exploit a vulnerability with a harmful result. Security Policy A set of rules and practices that specify or regulate how a system or organization provides security services to protect sensitive and critical system resources.
[Page 15]
OSI Security Architecture • The security manager is responsible for : • assessing and evaluating the security needs of an organization effectively, • evaluating and choosing various security products, policies, • It needs some systematic way of defining the requirements for security and characterizing the approaches to satisfying those requirements. • Designing the above needs is too difficult in a centralized data processing environment; which uses of local and wide area networks. wide area networks. • Security architecture and design contains the concepts, principles, structures, and standards used to design, monitor, and secure; operating systems, equipment, networks, applications, and those controls used to enforce various levels of availability, integrity, and confidentiality. • The OSI security architecture is useful to managers as a way of organizing the task of providing security. • This architecture was developed as an international standard • All computer and communications vendors have developed security features for their products and services that relate to this structured definition of services and mechanisms. • The OSI security architecture focuses on security attacks, mechanisms, and services. These are defined briefly in the next slide.
[Page 16]
OSI Security Architecture • Security attack : Any action that compromises the security of information owned by an organization. • Security mechanism : A process (or a device incorporating such a process) that is designed to detect, prevent, or recover from a security attack. designed to detect, prevent, or recover from a security attack. • Security service : A processing or communication service that enhances the security of the data processing systems and the information transfers of an organization. • The services are intended to counter security attacks, and they make use of one or more security mechanisms to provide the service.
[Page 17]
[No readable text detected]
[Page 18]
Threat vs Attack • Threat: A potential for violation of security, which exists when there is a circumstance, capability, action, or event that could breach security and cause harm. That is, a threat is a possible danger that might exploit a vulnerability. • Attack: An assault on system security that derives from an intelligent threat that is, an intelligent act that is a deliberate attempt (especially in the sense of a method or technique) to evade security services and violate the security policy of a system Two types of attacks: • Active attack : An attempt to alter system resources or affect their operation. • Passive attack : An attempt to learn or make use of information from the system that does not affect system resources. • Inside attack : Initiated by an entity inside the security perimeter (an “insider”).The insider is authorized to access system resources but uses them in a way not approved by those who granted the authorization. • Outside attack : Initiated from outside the perimeter, by an unauthorized or illegitimate user of the system (an “outsider”). On the Internet, potential outside attackers range from amateur pranksters to organized criminals, international terrorists, and hostile governments
[Page 19]
[No readable text detected]
[Page 20]
[No readable text detected]
[Page 21]
[No readable text detected]
[Page 22]
Types of Passive attacks
[Page 23]
Types of Passive attacks • Eavesdropping on, or monitoring of, transmissions. • The goal of the opponent is to obtain information that is being transmitted. • A phone conversation, an email or a file under transmission may be eavesdropped • If the messages are encrypted the • If the messages are encrypted the opponents, cannot extract the information even if they captured the message. • Opponent might still be able to observe the pattern of these messages. • The opponent could determine the • location and identity of communicating hosts • observe the frequency and length of messages being exchanged. • This information is useful in guessing the nature of the communication that's taking place.
[Page 24]
Active attacks
[Page 25]
Types of active attacks A masquerade takes place when one entity pretends to be a different entity Modification of messages simply means that some portion of a legitimate message is altered, or that messages are delayed or reordered, to produce an unauthorized effect
[Page 26]
Types of active attacks Replay involves the passive capture of a data unit and its subsequent re- transmission to produce an unauthorized effect The denial of service • Prevents or inhibits the normal use or management of communications facilities. • may have a specific target; for example, an entity may suppress all messages directed to a particular destination (e.g., the security audit service). • Another form is the disruption of an entire network, either by disabling the network or by overloading it with messages so as to degrade performance.
[Page 27]
• Active attacks present the opposite characteristics of passive attacks. • Passive attacks are difficult to detect. Measures are available to prevent their success. • On the other hand, it is quite difficult to prevent active attacks absolutely, because of the wide variety of potential physical, software, and network vulnerabilities. • The goal is to detect active attacks and to recover from any disruption or delays caused by them. Active Vs Passive attacks • The goal is to detect active attacks and to recover from any disruption or delays caused by them.
[Page 28]
Services • X.800 defines a security service as a service that is provided by a protocol layer of communicating systems and that ensures adequate security of the systems or of data transfers. • RFC 4949 defines security service as a processing or communication service that is provided by a system to give a specific kind of protection to system resources. Security services implement security policies with the help of security mechanisms. • X.800 divides security services into five categories and fourteen specific services. • Authentication • Peer Entity Authentication • Data-Origin Authentication • Access Control • Data Confidentiality • Connection Confidentiality • Connectionless Confidentiality • Selective-Field Confidentiality • Traffic-flow Confidentiality • Data Integrity • Connection Integrity with Recovery • Connection Integrity without Recovery • Selective-field Connective Integrity • Connectionless Integrity • Selective-field Connectionless Integrity • Nonrepudiation • Nonrepudiation Origin • Nonrepudiation Destination
[Page 29]
Security Mechanisms • Specific Security Mechanisms • Encipherment • Digital Signature • Access Control • Data Integrity • Pervasive Security Mechanisms • Trusted Functionality • Security Label • Event Detection • Security Audit Trail Data Integrity • Authentication exchange • Traffic Padding • Routing Control • Notarization • Security Audit Trail • Security Recovery
[Page 30]
Encipherment • The use of mathematical algorithms to transform data into a form that is not readily intelligible. The transformation and subsequent recovery of the data depend on an algorithm and zero or more encryption keys. Digital Signature • Data appended to, or a cryptographic transformation of, a data unit that allows a recipient of the data unit to prove the source and integrity of the data unit and protect against forgery (e.g., by the recipient).
[Page 31]
Access Control • A variety of mechanisms that enforce access rights to resources. Data Integrity • A variety of mechanisms used to assure the integrity of a data unit or stream of data units. Authentication Exchange • A mechanism intended to ensure the identity of an entity by means of information exchange • A mechanism intended to ensure the identity of an entity by means of information exchange Traffic Padding • The insertion of bits into gaps in a data stream to frustrate traffic analysis attempts. Routing Control • Enables selection of particular physically secure routes for certain data and allows routing changes, especially when a breach of security is suspected. Notarization • The use of a trusted third party to assure certain properties of a data exchange.
[Page 32]
Mapping security services to mechanisms
[Page 33]
Symmetric cipher model
[Page 34]
Symmetric cipher model • A source produces a message in plaintext, X. • For encryption, a key of the form K is generated. • With the message X and the encryption key K as input, the encryption algorithm forms the ciphertext Y as: Y = E(K,X) • The intended receiver, in possession of the key, is able to invert the transformation as: X = D(K,Y) • An opponent, observing Y but not having access to K or X, may attempt to recover X or K or both X and K. • An opponent, observing Y but not having access to K or X, may attempt to recover X or K or both X and K.
[Page 35]
Cryptographic systems are characterization
[Page 36]
Cryptanalysis Vs Brute force attack
[Page 37]
Cryptanalytic attacks
[Page 38]
Classical encryption types overview
[Page 39]
Caesar Cipher • The simplest use of a substitution cipher was by Julius Caesar. • The Caesar cipher involves replacing each letter of the alphabet with the letter standing three places further down the alphabet. • Example Technique: The alphabet is wrapped around, so that the letter following Z is A. • Let us assign a numerical equivalent to each letter:
[Page 40]
Caesar Cipher Let us assign a numerical equivalent to each letter The General Caesar algorithm can be expressed as follows: The General Caesar algorithm can be expressed as follows: Encryption : C = E(K, P) = (P + K) mod 26 Decryption : P = D(K, C) = (C – K) mod 26 If it is known that a given ciphertext is a Caesar cipher, then a brute-force cryptanalysis is easily performed:
[Page 41]
Caesar Cipher Plaintext G I T A M U N I V E R S I T Y P Value 6 8 19 0 12 20 13 8 21 4 17 18 8 19 24 • Encryption : C = (p + k) mod 26 • Plaintext : Gitam University P Value 6 8 19 0 12 20 13 8 21 4 17 18 8 19 24 Key = 3 9 mod 26 11 mod 26 22 mod 26 3 mod 26 15 mod 26 23 mod 26 16 mod 26 11 mod 26 24 mod 26 7 mod 26 20 mod 26 21 mod 26 11 mod 26 22 mod 26 27 mod 26 C Value 9 11 22 3 15 23 16 11 24 7 20 21 11 22 1 Ciphertext J L W D P X Q L Y H U V L W B Ciphertext : JLWDPXQLYHUVLWB
[Page 42]
Monoalphabetic Cipher • With only 25 possible keys, the Caesar cipher is far from secure. • Rather than just shifting the alphabet, we could shuffle (jumble) the letters arbitrarily. • Each plaintext letter maps to a different random cipher text letter. • Hence key is 26 letters long. PLAIN a b c d e f g h I j k l m n o p q r s t u v w x y z KEY D K V Q F I B J W P E S C X H T M Y A U O L R G Z N • Plaintext : “if we wish to replace letters” • Ciphertext : ? KEY D K V Q F I B J W P E S C X H T M Y A U O L R G Z N P.T i f w e w i s h t o r e p l a c e l e t t e r s C.T W I R F R W A J U H Y F T S D V F S F U U F Y A
[Page 43]
• Now we have a total of 26! Keys. • With so many keys, might think the system is secure. But would be !!! WRONG !!! • Problem is the regularities of the language. • Languages are redundant, letters are not equally commonly used. Monoalphabetic Cipher • The English letter E is by far the most common letter, then T,R,N,I,O,A,S. • Other letters are fairly rare like Z,J,K,Q,X . • Key concept - monoalphabetic substitution ciphers do not change relative letter frequencies. • Discovered by Arabian scientists in 9 th century. • Calculate letter frequencies for ciphertext and compare counts against known values for the example in the next slide
[Page 44]
• Given ciphertext: UZQSOVUOHXMOPVGPOZPEVSGZWSZOPFPESXUDBMETSXAIZ VUEPHZHMDZSHZOWSFPAPPDTSVPQUZWYMXUZUHSX EPYEPOPDZSZUFPOMBZWPFUPZHMDJUDTMOHMQ • Count relative letter frequencies. • The most common letters are P & Z and are equivalent to e and t. Monoalphabetic Cipher • The most common letters are P & Z and are equivalent to e and t. • The most common Diagram are ZW is equivalent to 'th' and hence ZWP is ' the'. • Proceeding with trial and error finally get: it was disclosed yesterday that several informal but direct contacts have been made with political representatives of the viet cong in moscow
[Page 45]
Play fair Cipher • The large number of keys in a monoalphabetic cipher also does not provide security. • One approach to improve security was to encrypt multiple letters. Playfair Cipher is an example for such an approach. • Invented by Charles Wheatstone in 1854 , but named after his friend Baron Playfair. • Playfair cipher is the best-known multi-letter encryption cipher. • It's based on a 5 x 5 matrix of letters constructed using a keyword. • Firstly fill the matrix with the letters of the keyword (dropping any duplicate letters). • Then fill the remaining empty locations with the rest of the letters of the alphabets in order (A...Z) • As 5x5 matrix can hold only 25 elements, any 2 alphabets can be paired. (It's a convention to put both "I" and "J" in the same space .)
[Page 46]
• pair are separated with a filler letter, such as x. Example: 1. balloon has to be written as ba ll oo n but, due to the rule that same pair of alphabets cannot be in the same group its paired as ba lx lo on . 2. GITAM would be grouped as GI TA MX. Filler Character X is appended inorder to have a pair for M • Each plaintext letter in a pair is replaced by the letter that lies in its own row and the column occupied by the other plaintext letter. Play fair Cipher other plaintext letter. • Example: • hs becomes BP • and ea becomes IM (or JM, as the encipher wishes). • Two plain text letters that fall in the same row of the matrix are each replaced by the letter to the right. • Two plain text letters that fall in the same column of the matrix are each replaced by the letter beneath. • Otherwise each plain text letter in pair is replaced by that lies in it's own row and column occupied by the other plain text letter.
[Page 47]
Plain text: hide the gold Key : hello world Cipher text: ? Play fair Cipher Example H E L O W R D A B C hi de th eg ol dz lf gd nw dp wo cv • Security is much improved over monoalphabetic since have 26 x 26 = 676 diagrams. R D A B C F G I/J K M N P Q S T U V X Y Z diagrams. • It would need a 676 entry frequency table to analyse (verses 26 for a monoalphabetic) • It was widely used for many years (eg. US & British military in WW1) • It can be broken, given a few hundred letters since still has much of plaintext structure.
[Page 48]
Hill Cipher • Developed by the mathematician Lester Hill in 1929. • The encryption algorithm takes m successive plain text and substitutes them with m cipher text letters. • Each character is assigned a numerical value (a=0,…z=25). • Encryption: Multiply each block by K and then reduce mod 26. • Decryption: multiply each block by the inverse of K , and reduce mod 26. Example: • Plain text: "LOVE", Secret Key: • LO 🡪 • VE 🡪 • 2, 3, 16, 5 are transformed to cipher text "CDQF"
[Page 49]
How to decode? • Given "CDQF", and the key • How do we decrypt? • We need to compute the inverse of Hill Cipher Note: Remember that all arithmetic are mod 26. There is no fraction and care should be taken in computing multiplicative inverse mod 26. • The determinant of equals 20(7) - 3(15), which is 17 mod 26. • Find the multiplicative inverse of 17 mod 26, i.e., find integer x such that 17. x = 1 mod 26. • Just try all 26 possibilities for x:23
[Page 50]
Computing the inverse mod 26 • From 17×23= 1 mod 26, we know that the multiplicative inverse of 17 mod 26 is 23. • Using the formula for 2 × 2 matrix inverse • We get Hill Cipher • We get Replace (17) -1 mod 26 by 23
[Page 51]
Decryption: Given the ciphertext "CDQF", we decrypt by multiplying by Hill Cipher Strength: • Hill cipher completely hides single-letter frequencies. 11, 14, 21, 4 is " LOVE". • Hill cipher completely hides single-letter frequencies. • The use of a larger matrix hides more frequency information. • For example, a 3 x 3 Hill cipher hides not only single-letter but also two-letter frequency information. Weakness: • Although the Hill cipher is strong against a ciphertext-only attack, it is easily broken with a known plaintext attack.
[Page 52]
Polyalphabetic Cipher Autokey Cipher: • The term autokey refers to any cipher where the key is based on the original plaintext. • Encryption using the Autokey Cipher is very similar to the Vigenère Cipher, except in the creation of the keystream. • The keystream is made by starting with the keyword, and then appending to the end • The keystream is made by starting with the keyword, and then appending to the end of this the plaintext itself. • Plaintext : meet me at the corner • Key : KING P.T 12 4 4 19 12 4 0 19 19 7 4 2 14 17 13 4 17 Key 10 8 13 6 12 4 4 19 12 4 0 19 19 7 4 2 14 C.T 22 12 17 25 24 8 4 12 5 11 4 21 7 24 17 6 5 Encryption : Ci = (pi + ki mod m) mod 26 Decryption : pi = (Ci – ki mod m) mod 26
[Page 53]
Polyalphabetic Cipher Vigenere Cipher • One of the simplest, polyalphabetic cipher. • Assume a sequence of Plaintext letters P, P = p0, p1, p2, …., pn-1 Decryption: pi = (Ci – ki mod m) mod 26 • To encrypt a message, a key is needed that is as long as the message. • The key is a repeating keyword. Example: • A Key consisting of the sequence of letters K, K = k0, k1, k2, …, km-1 where m < n • The sequence of Ciphertext letters C, C = C0, C1, C2, ….. , Cn-1 • is calculated as: Ci = (pi + ki mod m) mod 26 Example: • keyword = deceptive • Plaintext = we are discovered save yourself • is encrypted as
[Page 54]
Vernam Cipher The system can be expressed as: ci = pi ⊕ ki where pi = i th binary digit of plaintext ki = i th binary digit of key c = i th binary digit of ciphertext ⊕ In Vernam cipher algorithm, length of key = length of plaintext Example, Plaintext = H e l l o 7 4 11 11 14 ci = i th binary digit of ciphertext ⊕ = exclusive-or (XOR) operation The ciphertext is generated by performing the bitwise XOR of the plaintext and the key. Because of the properties of the XOR, decryption is given as: pi = ci ⊕ ki 7 4 11 11 14 Key = D G H B C 3 6 7 1 2 Ciphertext = 4 2 12 10 12 E C M K M
[Page 55]
One Time Pad (OTP) • An Army Signal Corp officer, Joseph Mauborgne, proposed an improvement to the Vernam cipher that yields the ultimate in security. • He suggested using a random key that is at least as long as the message, so that the key need not be repeated. • The key is used to encrypt and decrypt a single message, and then it is discarded. • The resulting ciphertext will be impossible to decrypt or break if the following four conditions are met: 1. The key must be truly random. 2. The key must be at least as long as the plaintext. 3. The key must never be reused in whole or in part. 4. The key must be kept completely secret • Each new message requires a new key of the same length as the new message. • Plaintext : hello • Key : XMCKL Plaintext h e l l o P.T Value 7 4 11 11 14 Key X M C K L Key Value 23 12 2 10 11 C.T Value 30mod26= 4 16mod26=16 13mod26= 13 21mod26=21 25mod26=25 CIPHERTEXT E Q N V Z
[Page 56]
TRANSPOSITION CIPHERS • A transposition cipher is one which rearranges the order of the letters in the ciphertext (encoded text), according to some predetermined method, without making any substitutions . • Transposition cipher types: • Rail fence • Columnar Transposition Cipher • Double Transposition Cipher
[Page 57]
Rail Fence The simplest transposition cipher. Rail fence - the plaintext is written down as a sequence of diagonals and then read off as a sequence of rows. Example : to encipher the message " meet me after the toga party " with a rail fence of depth 2, we write: E M E M A T R H T G P R Y • The encrypted message is MEMATRHTGPRYETEFETEOAAT • Plain text –MEMATRHTGPRY ETEFETEOAAT • This sort of thing would be trivial to cryptanalyze. M E M A T R H T G P R Y E T E F E T E O A A T
[Page 58]
Encryption • Plaintext : GITAM UNIVERSITY • Depth : 4 • Cipher text- GNIIUISTTMVRYAEX G N I I U I S T T M V R Y A E X Take cipher text GNIIUISTTMVRYAEX Fill row-wise leaving diagonally Decryption G N I - - - - - - - - - - Fill row-wise leaving diagonally - - - - - - - - G N I I U I S T - - - - - - - - To retrieve back write in zigzag fashion Plaintext : GITAM UNIVERSITY
[Page 59]
Columnar Transposition Cipher • Write the message in a rectangle, row by row, and read the message, column by column, but permute the order of the columns. • The order of the columns then becomes the key to the algorithm. • Example: • Here, the key is 4312567.
[Page 60]
Example: Plain text- GITAMITES SAY HELO Key-3124 Cipher Text-IISE TTAL GMSH AEYO Plain text-Fill the 1 st col with IISE 2 nd with TTAL and soon Columnar Transposition Cipher G I T A M I T E S S A Y H E L O 3 1 2 4 • To encrypt, • Start with the column that is labeled 1, in this case column 3. Write down all the letters in that column. • Proceed to column 4, which is labeled 2, then column 2, then column 1, then columns 5, 6, and 7. • Pure transposition cipher is easily recognized because it has the same letter frequencies as the original plaintext. • Cryptanalysis is fairly straightforward and involves laying out the ciphertext in a matrix and playing around with column positions.
[Page 61]
Double Transposition • Double transposition is simply a columnar transposition applied twice. • The transposition cipher can be made significantly more secure by performing more than one stage of transposition. • Resulting in a more complex permutation that is not easily reconstructed. • The foregoing message is re-encrypted using the same algorithm, • The foregoing message is re-encrypted using the same algorithm, Example: Plain text- GITAMITES SAY HELO Key-3124 Result after columnar Cipher Text- IISE TTAL GMSH AEYO Result after double columnar Cipher text- ITME SASY ITGA ELHO G I T A M I T E S S A Y H E L O 3 1 2 4 Plain text-Fill the 1 st col with ITME 2 nd with SSAY and soon I I S E T T A L G M S H A E Y O 3 1 2 4
[Page 62]
Practice questions 1.Key="GITAM", consider Your Full Name as Plain Text, Using Vigenere Cipher find the Cipher Text 2.Key = 4, Consider your Roll Number as plain text , Find the Cipher Text using Rail Fence Technique 3.Key = your name, consider the plain text "We need to face the Challange", use Auto Cipher to find the Cipher Text 4.Key = [5, 8 17, 3 ] a 2 x 2 matrix, Consider the last 2 digits of your roll number as plain Text and find the cipher Text using Hill Cipher 5.Key="Cryptography", Consider your surname as Plaint text and find the Cipher text using PlayFair Cipher 6.What is the result of double transposition technique, Key is: 4 3 1 2 5 Plaintext is : "departmentofcsevisakhapatnam" after the second transposition what is the output? 7.Decrypt the Cipher Text "THTIPPNTOYENCGIRGRRSEYAIS" using the key=45213 with Columnar Transposition Technique
[Page 63]
References 1.William Stallings, Cryptography and Network Security – Principles and Practice, 7/e. Pearson Education, 2017. 2. Behrouz A .Forouzan and Debdeep Mukhopadhyaya, Cryptography and Network Security, 3/e, McGraw Hill, 2015. 3. AtulKahate, Cryptography and Network Security, 4/e, Mc Graw Hill, 2019. 4. Introduction to Cryptography, Buchmann, Springer. 5. Applied Cryptograph, 2 nd Edition, Bruce Schneier, Johnwiley & Sons Note : Incorporated the presentations .ai tools for preparing slides and pictures Find the URL : https://app.presentations.ai/view/Tr4MYRo7a7`;

console.log('Total length:', text.length);

// Simulate revisionCoverageText
function chunkDocument(text, { sourceId, dedupe }) {
  // Simple chunking by paragraphs
  const chunks = text.split('\n\n').filter(c => c.trim().length > 0);
  return chunks.map((chunk, index) => ({
    index,
    text: chunk.trim(),
    startPage: null,
    endPage: null,
    sourceId
  }));
}

const chunks = chunkDocument(text, { sourceId: 'test', dedupe: true });
console.log('Number of chunks:', chunks.length);

const maxChunks = 18;
if (chunks.length <= maxChunks) {
  console.log('Using full text');
} else {
  const stride = Math.max(1, Math.floor(chunks.length / maxChunks));
  const indexes = new Set();
  for (let index = 0; index < chunks.length && indexes.size < maxChunks; index += stride) {
    indexes.add(index);
  }
  indexes.add(chunks.length - 1);
  
  const selected = [...indexes]
    .sort((a, b) => a - b)
    .slice(0, maxChunks)
    .map((index) => chunks[index])
    .filter(Boolean);
    
  console.log('Selected chunks:', selected.length);
  const totalChars = selected.reduce((sum, c) => sum + c.text.length, 0);
  console.log('Total chars in selected:', totalChars);
}