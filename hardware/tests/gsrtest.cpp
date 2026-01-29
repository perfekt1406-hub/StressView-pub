const int GSR_PIN = A0;

void setup() {
  Serial.begin(9600);
}

void loop() {
  int gsrValue = analogRead(GSR_PIN);
  Serial.println(gsrValue);
  delay(10);  // Adjust sampling rate
}
