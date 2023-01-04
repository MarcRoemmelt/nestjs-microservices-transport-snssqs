<h1 align="center"></h1>

<div align="center">
  <a href="http://nestjs.com/" target="_blank">
    <img src="https://nestjs.com/img/logo_text.svg" width="150" alt="Nest Logo" />
  </a>
</div>

<h3 align="center">NestJS SNS/SQS Custom Transporter</h3>

<div align="center">
  <a href="https://nestjs.com" target="_blank">
    <img src="https://img.shields.io/badge/built%20with-NestJs-red.svg" alt="Built with NestJS">
  </a>
</div>

> **_NOTE:_**  This is a proof-of-concept and not production ready. Rather, I would advice again using SNS and SQS for the transport layer of NestJS microservices. Reason being that neither SNS nor SQS has adequate support to *push* messages to a client. SQS exclusively supports long-polling, while SNS only supports pushing messages to HTTP endpoints.

## Author

**Marc Römmelt**

## License

Licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
