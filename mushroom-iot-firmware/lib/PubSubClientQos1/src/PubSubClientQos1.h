/*
 PubSubClientQos1.h - A simple client for MQTT.
  Nick O'Leary
  http://knolleary.net
*/

#ifndef PubSubClientQos1Qos1_h
#define PubSubClientQos1Qos1_h

#include <Arduino.h>
#include "IPAddress.h"
#include "Client.h"
#include "Stream.h"

#define MQTT_VERSION_3_1      3
#define MQTT_VERSION_3_1_1    4

// MQTT_VERSION : Pick the version
//#define MQTT_VERSION MQTT_VERSION_3_1
#ifndef MQTT_VERSION
#define MQTT_VERSION MQTT_VERSION_3_1_1
#endif

// MQTT_MAX_PACKET_SIZE : Maximum packet size. Override with setBufferSize().
#ifndef MQTT_MAX_PACKET_SIZE
#define MQTT_MAX_PACKET_SIZE 256
#endif

// MQTT_KEEPALIVE : keepAlive interval in Seconds. Override with setKeepAlive()
#ifndef MQTT_KEEPALIVE
#define MQTT_KEEPALIVE 15
#endif

// MQTT_SOCKET_TIMEOUT: socket timeout interval in Seconds. Override with setSocketTimeout()
#ifndef MQTT_SOCKET_TIMEOUT
#define MQTT_SOCKET_TIMEOUT 15
#endif

// MQTT_MAX_TRANSFER_SIZE : limit how much data is passed to the network client
//  in each write call. Needed for the Arduino Wifi Shield. Leave undefined to
//  pass the entire MQTT packet in each write call.
//#define MQTT_MAX_TRANSFER_SIZE 80

// Possible values for client.state()
#define MQTT_CONNECTION_TIMEOUT     -4
#define MQTT_CONNECTION_LOST        -3
#define MQTT_CONNECT_FAILED         -2
#define MQTT_DISCONNECTED           -1
#define MQTT_CONNECTED               0
#define MQTT_CONNECT_BAD_PROTOCOL    1
#define MQTT_CONNECT_BAD_CLIENT_ID   2
#define MQTT_CONNECT_UNAVAILABLE     3
#define MQTT_CONNECT_BAD_CREDENTIALS 4
#define MQTT_CONNECT_UNAUTHORIZED    5

#define MQTTCONNECT     1 << 4  // Client request to connect to Server
#define MQTTCONNACK     2 << 4  // Connect Acknowledgment
#define MQTTPUBLISH     3 << 4  // Publish message
#define MQTTPUBACK      4 << 4  // Publish Acknowledgment
#define MQTTPUBREC      5 << 4  // Publish Received (assured delivery part 1)
#define MQTTPUBREL      6 << 4  // Publish Release (assured delivery part 2)
#define MQTTPUBCOMP     7 << 4  // Publish Complete (assured delivery part 3)
#define MQTTSUBSCRIBE   8 << 4  // Client Subscribe request
#define MQTTSUBACK      9 << 4  // Subscribe Acknowledgment
#define MQTTUNSUBSCRIBE 10 << 4 // Client Unsubscribe request
#define MQTTUNSUBACK    11 << 4 // Unsubscribe Acknowledgment
#define MQTTPINGREQ     12 << 4 // PING Request
#define MQTTPINGRESP    13 << 4 // PING Response
#define MQTTDISCONNECT  14 << 4 // Client is Disconnecting
#define MQTTReserved    15 << 4 // Reserved

#define MQTTQOS0        (0 << 1)
#define MQTTQOS1        (1 << 1)
#define MQTTQOS2        (2 << 1)

// Maximum size of fixed header and variable length size header
#define MQTT_MAX_HEADER_SIZE 5
#define MQTT_QOS1_PENDING_PACKET_MAX 2048
/// Depth of the bounded outbound QoS-1 queue. Allows multiple back-to-back
/// ACKs without losing packets while a prior PUBACK is still in flight.
/// Each slot holds one full MQTT PUBLISH packet payload buffer.
#define MQTT_QOS1_OUTBOUND_QUEUE_DEPTH 4

enum class PublishQos1Result : uint8_t {
   QUEUED,
   BUSY,
   NOT_CONNECTED,
   INVALID_ARGUMENT,
   TRANSPORT_ERROR,
};

#if defined(ESP8266) || defined(ESP32)
#include <functional>
#define MQTT_CALLBACK_SIGNATURE std::function<void(char*, uint8_t*, unsigned int)> callback
#else
#define MQTT_CALLBACK_SIGNATURE void (*callback)(char*, uint8_t*, unsigned int)
#endif

#define CHECK_STRING_LENGTH(l,s) if (l+2+strnlen(s, this->bufferSize) > this->bufferSize) {_client->stop();return false;}

class PubSubClientQos1 : public Print {
private:
   Client* _client;
   uint8_t* buffer;
   uint16_t bufferSize;
   uint16_t keepAlive;
   uint16_t socketTimeout;
   uint16_t nextMsgId;
   unsigned long lastOutActivity;
   unsigned long lastInActivity;
   bool pingOutstanding;
   MQTT_CALLBACK_SIGNATURE;
   uint32_t readPacket(uint8_t*);
   boolean readByte(uint8_t * result);
   boolean readByte(uint8_t * result, uint16_t * index);
   boolean write(uint8_t header, uint8_t* buf, uint16_t length);
   uint16_t writeString(const char* string, uint8_t* buf, uint16_t pos);
   // Build up the header ready to send
   // Returns the size of the header
   // Note: the header is built at the end of the first MQTT_MAX_HEADER_SIZE bytes, so will start
   //       (MQTT_MAX_HEADER_SIZE - <returned size>) bytes into the buffer
   size_t buildHeader(uint8_t header, uint8_t* buf, uint16_t length);
   IPAddress ip;
   const char* domain;
   uint16_t port;
   Stream* stream;
   int _state;
   struct PendingQos1Publish {
       bool active;
       uint16_t messageId;
       uint16_t packetLength;
       unsigned long lastAttemptAt;
       uint8_t retryCount;
       uint8_t packet[MQTT_QOS1_PENDING_PACKET_MAX];
   } pendingQos1{};
    // Bounded outbound FIFO queue: stores packets that arrive while pendingQos1
    // is still active. Capacity = MQTT_QOS1_OUTBOUND_QUEUE_DEPTH entries.
    // Head is the next-to-dequeue index; count is the number of queued entries.
    struct QueuedQos1Entry {
        uint16_t packetLength;
        uint8_t packet[MQTT_QOS1_PENDING_PACKET_MAX];
    };
    QueuedQos1Entry outboundQueue_[MQTT_QOS1_OUTBOUND_QUEUE_DEPTH]{};
    uint8_t outboundQueueHead_ = 0;
    uint8_t outboundQueueCount_ = 0;
    bool enqueueQos1Packet(const uint8_t* packet, uint16_t length);
    bool dequeueAndSendNextQos1();
    bool writePendingQos1(bool duplicate);
    void servicePendingQos1(unsigned long now);
    /// Resend all queued packets after reconnect (reconnect-safe resend).
    void resendQueuedQos1OnConnect();
public:
   PubSubClientQos1();
   PubSubClientQos1(Client& client);
   PubSubClientQos1(IPAddress, uint16_t, Client& client);
   PubSubClientQos1(IPAddress, uint16_t, Client& client, Stream&);
   PubSubClientQos1(IPAddress, uint16_t, MQTT_CALLBACK_SIGNATURE,Client& client);
   PubSubClientQos1(IPAddress, uint16_t, MQTT_CALLBACK_SIGNATURE,Client& client, Stream&);
   PubSubClientQos1(uint8_t *, uint16_t, Client& client);
   PubSubClientQos1(uint8_t *, uint16_t, Client& client, Stream&);
   PubSubClientQos1(uint8_t *, uint16_t, MQTT_CALLBACK_SIGNATURE,Client& client);
   PubSubClientQos1(uint8_t *, uint16_t, MQTT_CALLBACK_SIGNATURE,Client& client, Stream&);
   PubSubClientQos1(const char*, uint16_t, Client& client);
   PubSubClientQos1(const char*, uint16_t, Client& client, Stream&);
   PubSubClientQos1(const char*, uint16_t, MQTT_CALLBACK_SIGNATURE,Client& client);
   PubSubClientQos1(const char*, uint16_t, MQTT_CALLBACK_SIGNATURE,Client& client, Stream&);

   ~PubSubClientQos1();

   PubSubClientQos1& setServer(IPAddress ip, uint16_t port);
   PubSubClientQos1& setServer(uint8_t * ip, uint16_t port);
   PubSubClientQos1& setServer(const char * domain, uint16_t port);
   PubSubClientQos1& setCallback(MQTT_CALLBACK_SIGNATURE);
   PubSubClientQos1& setClient(Client& client);
   PubSubClientQos1& setStream(Stream& stream);
   PubSubClientQos1& setKeepAlive(uint16_t keepAlive);
   PubSubClientQos1& setSocketTimeout(uint16_t timeout);

   boolean setBufferSize(uint16_t size);
   uint16_t getBufferSize();

   boolean connect(const char* id);
   boolean connect(const char* id, const char* user, const char* pass);
   boolean connect(const char* id, const char* willTopic, uint8_t willQos, boolean willRetain, const char* willMessage);
   boolean connect(const char* id, const char* user, const char* pass, const char* willTopic, uint8_t willQos, boolean willRetain, const char* willMessage);
   boolean connect(const char* id, const char* user, const char* pass, const char* willTopic, uint8_t willQos, boolean willRetain, const char* willMessage, boolean cleanSession);
   void disconnect();
   boolean publish(const char* topic, const char* payload);
   boolean publish(const char* topic, const char* payload, boolean retained);
   boolean publish(const char* topic, const uint8_t * payload, unsigned int plength);
   boolean publish(const char* topic, const uint8_t * payload, unsigned int plength, boolean retained);
   /**
    * Queue one QoS 1 PUBLISH for asynchronous broker acknowledgement.
    * QUEUED means only that the transport accepted the initial packet; call
    * loop() continuously so PUBACK matching and bounded DUP retransmission run.
    */
   PublishQos1Result publishQos1(const char* topic, const uint8_t* payload,
                                 unsigned int plength, boolean retained);
    bool hasPendingQos1Publish() const { return pendingQos1.active; }
    uint16_t getPendingMessageId() const { return pendingQos1.messageId; }
   boolean publish_P(const char* topic, const char* payload, boolean retained);
   boolean publish_P(const char* topic, const uint8_t * payload, unsigned int plength, boolean retained);
   // Start to publish a message.
   // This API:
   //   beginPublish(...)
   //   one or more calls to write(...)
   //   endPublish()
   // Allows for arbitrarily large payloads to be sent without them having to be copied into
   // a new buffer and held in memory at one time
   // Returns 1 if the message was started successfully, 0 if there was an error
   boolean beginPublish(const char* topic, unsigned int plength, boolean retained);
   // Finish off this publish message (started with beginPublish)
   // Returns 1 if the packet was sent successfully, 0 if there was an error
   int endPublish();
   // Write a single byte of payload (only to be used with beginPublish/endPublish)
   virtual size_t write(uint8_t);
   // Write size bytes from buffer into the payload (only to be used with beginPublish/endPublish)
   // Returns the number of bytes written
   virtual size_t write(const uint8_t *buffer, size_t size);
   boolean subscribe(const char* topic);
   boolean subscribe(const char* topic, uint8_t qos);
   boolean unsubscribe(const char* topic);
   boolean loop();
   boolean connected();
   int state();

};


#endif
