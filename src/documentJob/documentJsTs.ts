import axios from 'axios'
import {config as dotenvConfig} from 'dotenv'
import fs from 'fs'
import {encode} from 'gpt-3-encoder'
import ts from 'typescript'
import {getNodeTypeString, isNodeExported} from './utils/nodeTypeHelper'
import {replaceOrInsertComment} from './utils/updateTsJsComment'
import otterConfig from '../otterConfigLoad'
dotenvConfig()

interface ResponseData {
  comment: string
  // Define other properties here if necessary
}

interface ExtractOptions {
  ArrowFunctionExpression?: boolean
  ClassDeclaration?: boolean
  ClassMethod?: boolean
  FunctionDeclaration?: boolean
  InterfaceDeclaration?: boolean
  TypeAlias?: boolean
  EnumDeclaration?: boolean
}

interface DocumentablePart {
  type: string
  code: string
  isPublic: boolean
  lineNumber?: number //used for sorting
  documentation?: string
  leadingComments?: {comment: string; range: ts.TextRange}[]
}

const generateDocumentation = async (
  part: DocumentablePart
): Promise<string | null> => {
  console.log('MADE IT HERE')
  if (otterConfig.debug) {
    // Return static comment
    return `/**
* Represents a network with Ethereum Virtual Machine (EVM) capabilities.
*
* @class
* @extends Network
*/`
  } else {
    try {
      const otterdocUrl = process.env.OTTERDOC_URL || 'https://www.otterdoc.ai'

      const previousComment =
        part.leadingComments && part.leadingComments.length > 0
          ? part.leadingComments[0].comment
          : ''
      const response = await axios.post(
        otterdocUrl + '/api/getComment',
        {
          apiKey: process.env.INPUT_KEY,
          functionString: part.code,
          previousComment: previousComment,
          funcType: part.type
        },
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      )

      if (!response.data) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      console.log('Got response from API', response.data)
      const data = response.data as ResponseData
      const documentation = data.comment
      return documentation
    } catch (error) {
      console.error('Error during API request:', error)
      return null
    }
  }
}

const extractDocumentableParts = (
  code: string,
  options: ExtractOptions
): DocumentablePart[] => {
  // Define DocumentablePart array to be returned
  const documentableParts: DocumentablePart[] = []

  // Create source file
  const sourceFile = ts.createSourceFile(
    'example.ts',
    code,
    ts.ScriptTarget.Latest,
    /*setParentNodes*/ true
  )

  function isOptionKey(
    key: string,
    options: ExtractOptions
  ): key is keyof ExtractOptions {
    return Object.keys(options).some(
      optionKey => optionKey === key && options[key as keyof ExtractOptions]
    )
  }

  // Helper function to check if a comment is a TypeDoc comment
  function isTypeDocComment(comment: string): boolean {
    return comment.startsWith('/**') && !comment.startsWith('/***')
  }

  function visit(node: ts.Node): void {
    // Get the node type
    const type = getNodeTypeString(node)
    const isPublic = isNodeExported(node)
    // Check if the node is one we want to document
    if (type && isOptionKey(type, options)) {
      const leadingComments = ts.getLeadingCommentRanges(
        code,
        node.getFullStart()
      )
      let comments: {comment: string; range: ts.TextRange}[] = []
      if (leadingComments) {
        leadingComments.forEach(commentRange => {
          const comment = code.slice(commentRange.pos, commentRange.end)
          if (isTypeDocComment(comment)) {
            comments.push({comment: comment, range: commentRange})
          }
        })
      }
      const start =
        sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1
      documentableParts.push({
        type,
        code: node.getText(),
        isPublic,
        lineNumber: start,
        leadingComments: comments
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return documentableParts
}

const options: ExtractOptions = {
  ArrowFunctionExpression: true,
  ClassDeclaration: true,
  ClassMethod: true,
  FunctionDeclaration: true,
  InterfaceDeclaration: true,
  TypeAlias: true,
  EnumDeclaration: true
}

export const documentJsTs = async (file: string): Promise<void> => {
  console.log(`Documenting file: ${file}`)
  let fileContent = fs.readFileSync(file, 'utf8')
  let documentableParts = extractDocumentableParts(fileContent, options)

  // Sort documentableParts in descending order by lineNumber
  documentableParts = documentableParts.sort(
    (a, b) => b.lineNumber! - a.lineNumber!
  )

  // Create a copy of the file content split by lines
  let fileContentLines = fileContent.split('\n')

  for (const part of documentableParts) {
    // Check if the part exceeds the token limit
    const tokens = encode(part.code)
    if (tokens.length > 4096) {
      console.log(`Part exceeds the token limit: ${part.code}`)
      continue
    }

    // Generate the documentation for this part
    // will be nothing if it fails
    part.documentation = (await generateDocumentation(part)) || ''
    if (part.documentation) {
      fileContentLines = replaceOrInsertComment(
        fileContentLines,
        fileContent,
        part
      )
    }
  }

  // Join the modified file content
  const updatedFileContent = fileContentLines.join('\n')

  // Write the modified file content to the original file, thus overwriting it
  fs.writeFileSync(file, updatedFileContent)

  console.log(documentableParts)
}
