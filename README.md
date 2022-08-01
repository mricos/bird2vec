# bird2vec
Bird2vec was a collaboration between conceptual artist Nire, Mike Ricos and Will Morgan.

We achieved her vision of a research based art project
 using machine learning to  create novel bird sounds that are "sonically-consistent" 
 with extinct bird recording while sonically evoking machine-like quality.
 
We used Chris Donahue's [wavgan](https://github.com/chrisdonahue/wavegan)
and retrained a GAN network with extinct bird
recordings, creating a sonic palette that allowed a mixture of latent space vectors that result
in convincing novel bird calls. The final product evokes
the strains between man, animal and machine. 

See Nire's presentation, [Podscape](https://vimeo.com/336814705),
at the Interactive Telecommunications Program (ITP) at NYU. Sound examples start at 3:00.



See [config](./config) for code that generated 3D Tensorboard visualization of training metrics and 
resultant latent space.
